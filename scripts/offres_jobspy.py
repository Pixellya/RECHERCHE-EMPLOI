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
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path

from jobspy import scrape_jobs

SORTIE = Path(__file__).resolve().parent.parent / "data" / "offres_jobspy.json"
JOURS = 14
PAR_RECHERCHE = 15  # volume volontairement faible
PAUSE = 5  # secondes entre deux recherches

METIERS = json.loads((Path(__file__).resolve().parent / "metiers.json").read_text(encoding="utf-8"))
RECHERCHES = METIERS["recherches"]

SITES = {
    "indeed": {"country_indeed": "France", "location": "Île-de-France"},
    # « Île-de-France » seul est compris comme l'île de Sein (Bretagne) : on précise Paris.
    "linkedin": {"location": "Paris, Île-de-France, France"},
}

IDF = re.compile(
    r"paris|[iî]le-de-france|hauts-de-seine|seine-saint-denis|val-de-marne|yvelines|essonne|"
    r"val-d.oise|seine-et-marne|\b(75|77|78|91|92|93|94|95)\d{3}\b|"
    r",\s*A8\b",  # code de l'Île-de-France chez Indeed (« Noisy-le-Grand, A8, FR »)
    re.I,
)


def simplifier(texte):
    """Minuscules, sans accents, sans marques de genre (« chargé(e) » → « charge »)."""
    t = unicodedata.normalize("NFD", texte or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower().replace("’", "'")
    t = re.sub(r"[-‐–]", " ", t)
    t = re.sub(r"([a-z])[(·.](e|ne|se|euse|rice|trice)\)?(?![a-z])", r"\1", t)
    return re.sub(r"\s+", " ", t)


def motif(termes):
    # Reconnu en début de mot : « event » trouve « events » mais pas « prévention ».
    return re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(t) for t in termes) + ")")


TITRES = {cat: motif(t) for cat, t in METIERS["titres"].items()}
MISSIONS = {cat: motif(t) for cat, t in METIERS["missions"].items()}
EXCLUS = motif(METIERS["exclus"])


def valeur(x):
    return None if x is None or (isinstance(x, float) and x != x) else x


def contrat(texte):
    t = (texte or "").upper()
    if re.search(r"\bCDD\b", t):
        return "CDD"
    if re.search(r"\bCDI\b", t):
        return "CDI"
    return None


def categorie(titre, description=""):
    """Le titre d'abord ; s'il est vague, les missions décrites dans l'annonce."""
    t = simplifier(titre)
    for cat, expr in TITRES.items():
        if expr.search(t):
            return cat
    d = simplifier(description)
    for cat, expr in MISSIONS.items():
        if len(set(expr.findall(d))) >= METIERS["missions_minimum"]:
            return cat
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
                # Contrat lu dans le titre ou la description ; sinon « Contrat à vérifier » sur le site.
                description = valeur(r.get("description")) or ""
                type_contrat = contrat(f"{titre} {description}")
                if not type_contrat and "contract" in (valeur(r.get("job_type")) or ""):
                    type_contrat = "CDD"
                cat = categorie(titre, description)
                raison = (
                    "sans titre" if not titre
                    else "hors métier" if not cat
                    else "hors Île-de-France" if not IDF.search(lieu)
                    else "métier exclu (stage, alternance, sécurité…)" if EXCLUS.search(simplifier(titre))
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
