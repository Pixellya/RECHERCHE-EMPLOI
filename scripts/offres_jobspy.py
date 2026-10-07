"""Récupère des offres Indeed et LinkedIn avec JobSpy (https://github.com/speedyapply/JobSpy)
et les écrit dans data/offres_jobspy.json, que scripts/fetch-offres.mjs fusionne ensuite.

On ne garde que le titre, l'entreprise, le lieu, la date et le lien vers l'annonce d'origine.
Chaque site et chaque recherche sont isolés : un blocage n'empêche pas le reste.

Lancement : python scripts/offres_jobspy.py
"""

import json
import re
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

from jobspy import scrape_jobs

SORTIE = Path(__file__).resolve().parent.parent / "data" / "offres_jobspy.json"
JOURS = 14
PAR_RECHERCHE = 20  # volume volontairement faible
PAUSE = 8  # secondes entre deux recherches

RECHERCHES = [
    "événementiel",
    "chef de projet événementiel",
    "chargé de communication",
    "chargée de communication",
]

SITES = {
    "indeed": {"country_indeed": "France", "location": "Île-de-France"},
    "linkedin": {"location": "Île-de-France, France"},
}

IDF = re.compile(
    r"paris|[iî]le-de-france|hauts-de-seine|seine-saint-denis|val-de-marne|yvelines|essonne|"
    r"val-d.oise|seine-et-marne|\b(75|77|78|91|92|93|94|95)\d{3}\b",
    re.I,
)
EXCLUS = re.compile(r"\b(stage|stagiaire|altern|apprenti|freelance|ind[ée]pendant|int[ée]rim)", re.I)
EVENEMENTIEL = re.compile(r"[ée]v[ée]nement|event|salon|festival|s[ée]minaire|r[ée]gie", re.I)
COMMUNICATION = re.compile(r"communication|community|relations presse|attach[ée] de presse|r[ée]seaux sociaux|brand|marketing", re.I)


def valeur(x):
    return None if x is None or (isinstance(x, float) and x != x) else x


def contrat(texte):
    t = (texte or "").upper()
    if re.search(r"\bCDD\b", t):
        return "CDD"
    if re.search(r"\bCDI\b", t):
        return "CDI"
    return None


def categorie(titre):
    if EVENEMENTIEL.search(titre):
        return "Événementiel"
    if COMMUNICATION.search(titre):
        return "Communication"
    return None


def main():
    offres = []
    for site, options in SITES.items():
        for recherche in RECHERCHES:
            try:
                df = scrape_jobs(
                    site_name=[site],
                    search_term=recherche,
                    results_wanted=PAR_RECHERCHE,
                    hours_old=24 * JOURS,
                    verbose=0,
                    **options,
                )
            except Exception as erreur:  # un site qui bloque ne doit pas arrêter le reste
                print(f"{site} « {recherche} » : {erreur}", file=sys.stderr)
                time.sleep(PAUSE)
                continue

            rejets = {}
            for r in df.to_dict("records"):
                titre = valeur(r.get("title")) or ""
                lieu = valeur(r.get("location")) or ""
                type_contrat = contrat(f"{titre} {valeur(r.get('description')) or ''}")
                cat = categorie(titre)
                raison = (
                    "sans titre" if not titre
                    else "hors métier" if not cat
                    else "hors Île-de-France" if not IDF.search(lieu)
                    else "stage, alternance ou freelance" if EXCLUS.search(titre)
                    # Indeed fournit la description : on exige CDI ou CDD. LinkedIn non : contrat inconnu.
                    else "ni CDI ni CDD" if site == "indeed" and not type_contrat
                    else None
                )
                if raison:
                    rejets.setdefault(raison, []).append(f"{titre} | {lieu}")
                    continue
                publiee = valeur(r.get("date_posted"))
                offres.append({
                    "id": f"{site}-{r.get('id')}",
                    "titre": titre,
                    "entreprise": valeur(r.get("company")),
                    "lieu": lieu,
                    "contrat": type_contrat,
                    "public": False,
                    "date": (publiee.isoformat() if isinstance(publiee, date) else datetime.now(timezone.utc).date().isoformat()),
                    "categorie": cat,
                    "source": "LinkedIn" if site == "linkedin" else "Indeed",
                    "url": r.get("job_url"),
                })
            print(f"{site} « {recherche} » : {len(df)} résultats bruts.")
            for raison, exemples in rejets.items():
                print(f"  écartés ({raison}) : {len(exemples)}, ex. {exemples[:2]}")
            time.sleep(PAUSE)

    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_text(json.dumps(offres, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"JobSpy : {len(offres)} offres retenues.")


if __name__ == "__main__":
    main()
