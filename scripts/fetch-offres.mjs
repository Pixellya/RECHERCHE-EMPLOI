// Récupère les dernières offres d'emploi en événementiel et communication
// depuis des sources officielles (API), puis les enregistre dans data/offres.json.
//
// Sources (chacune est ignorée si ses clés ne sont pas configurées) :
//   - France Travail : FRANCE_TRAVAIL_CLIENT_ID, FRANCE_TRAVAIL_CLIENT_SECRET
//   - Adzuna         : ADZUNA_APP_ID, ADZUNA_APP_KEY
//
// Filtres appliqués : Île-de-France uniquement, CDI et CDD uniquement.
//
// Lancement : node scripts/fetch-offres.mjs

import { writeFile, mkdir } from "node:fs/promises";

const OUTPUT = new URL("../data/offres.json", import.meta.url);
const JOURS = 14; // ancienneté maximale des offres conservées

// Codes métiers ROME de France Travail, classés par catégorie.
const ROME = {
  "Événementiel": ["E1107", "L1302", "L1509"],
  "Communication": ["E1103", "E1101", "E1401", "E1402"],
};

const MOTS_CLES = {
  "Événementiel": ["événementiel", "evenementiel", "événement", "evenement", "salon", "séminaire", "festival", "régie", "event"],
  "Communication": ["communication", "community manager", "relations presse", "attaché de presse", "chargé de com", "marketing digital", "réseaux sociaux", "brand content"],
};

// Départements d'Île-de-France.
const DEPARTEMENTS_IDF = ["75", "77", "78", "91", "92", "93", "94", "95"];
const CONTRATS = ["CDI", "CDD"];

function enIleDeFrance(codePostal, libelle) {
  const code = (codePostal ?? libelle ?? "").trim().slice(0, 2);
  return DEPARTEMENTS_IDF.includes(code);
}

// Repère les offres des mairies, départements, régions et administrations.
function secteurPublic(entreprise, secteur) {
  return /^84/.test(secteur ?? "") ||
    /mairie|commune|ville de|département|departement|conseil (départemental|general|général|régional)|région|agglom|métropole|metropole|préfecture|ministère|fonction publique|administration publique/i
      .test(`${entreprise ?? ""} ${secteur ?? ""}`);
}

function categorie(titre, codeRome) {
  for (const [cat, codes] of Object.entries(ROME)) {
    if (codes.includes(codeRome)) return cat;
  }
  const t = titre.toLowerCase();
  for (const [cat, mots] of Object.entries(MOTS_CLES)) {
    if (mots.some((m) => t.includes(m))) return cat;
  }
  return null;
}

// ---------- France Travail ----------

async function franceTravail() {
  const id = process.env.FRANCE_TRAVAIL_CLIENT_ID;
  const secret = process.env.FRANCE_TRAVAIL_CLIENT_SECRET;
  if (!id || !secret) {
    console.log("France Travail : clés absentes, source ignorée.");
    return [];
  }

  const tokenRes = await fetch(
    "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: id,
        client_secret: secret,
        scope: "api_offresdemploiv2 o2dsoffre",
      }),
    },
  );
  if (!tokenRes.ok) throw new Error(`France Travail (jeton) : HTTP ${tokenRes.status}`);
  const { access_token } = await tokenRes.json();

  const offres = [];
  for (const codes of Object.values(ROME)) {
    // L'API renvoie 150 offres maximum par appel ; on parcourt les pages.
    for (let debut = 0; debut < 900; debut += 150) {
      const params = new URLSearchParams({
        codeROME: codes.join(","),
        region: "11", // Île-de-France
        typeContrat: CONTRATS.join(","),
        publieeDepuis: String(JOURS),
        sort: "1",
        range: `${debut}-${debut + 149}`,
      });
      const res = await fetch(
        `https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${params}`,
        { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } },
      );
      if (res.status === 204) break; // aucun résultat
      if (!res.ok && res.status !== 206) throw new Error(`France Travail (recherche) : HTTP ${res.status}`);
      const { resultats = [] } = await res.json();
      for (const o of resultats) {
        if (!CONTRATS.includes(o.typeContrat)) continue;
        if (!enIleDeFrance(o.lieuTravail?.codePostal, o.lieuTravail?.libelle)) continue;
        offres.push({
          id: `ft-${o.id}`,
          titre: o.intitule,
          entreprise: o.entreprise?.nom ?? null,
          lieu: o.lieuTravail?.libelle ?? null,
          contrat: o.typeContrat,
          public: secteurPublic(o.entreprise?.nom, `${o.codeNAF ?? ""} ${o.secteurActiviteLibelle ?? ""}`.trim()),
          date: o.dateCreation,
          categorie: categorie(o.intitule, o.romeCode),
          source: o.origineOffre?.partenaires?.[0]?.nom ?? "France Travail",
          url:
            o.origineOffre?.partenaires?.[0]?.url ??
            o.origineOffre?.urlOrigine ??
            `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`,
        });
      }
      if (resultats.length < 150) break;
    }
  }
  console.log(`France Travail : ${offres.length} offres.`);
  return offres;
}

// ---------- Adzuna ----------

async function adzuna() {
  const id = process.env.ADZUNA_APP_ID;
  const key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) {
    console.log("Adzuna : clés absentes, source ignorée.");
    return [];
  }

  const offres = [];
  for (const recherche of ["événementiel", "chef de projet événementiel", "communication", "chargé de communication"]) {
    const params = new URLSearchParams({
      app_id: id,
      app_key: key,
      what: recherche,
      results_per_page: "50",
      sort_by: "date",
      max_days_old: String(JOURS),
      where: "Ile-de-France",
    });
    const res = await fetch(`https://api.adzuna.com/v1/api/jobs/fr/search/1?${params}`);
    if (!res.ok) throw new Error(`Adzuna : HTTP ${res.status}`);
    const { results = [] } = await res.json();
    for (const o of results) {
      const titre = o.title.replace(/<[^>]+>/g, "");
      const contrat = o.contract_type === "permanent" ? "CDI" : o.contract_type === "contract" ? "CDD" : null;
      if (!contrat) continue;
      const zones = (o.location?.area ?? []).map((z) => z.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
      if (!zones.includes("Ile-de-France")) continue;
      offres.push({
        id: `az-${o.id}`,
        titre,
        entreprise: o.company?.display_name ?? null,
        lieu: o.location?.display_name ?? null,
        contrat,
        public: secteurPublic(o.company?.display_name),
        date: o.created,
        categorie: categorie(titre),
        source: "Adzuna",
        url: o.redirect_url,
      });
    }
  }
  console.log(`Adzuna : ${offres.length} offres.`);
  return offres;
}

// ---------- Assemblage ----------

function dedoublonner(offres) {
  const vues = new Map();
  for (const o of offres) {
    const cle = `${o.titre}|${o.entreprise ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();
    if (!vues.has(cle)) vues.set(cle, o);
  }
  return [...vues.values()];
}

const resultats = await Promise.allSettled([franceTravail(), adzuna()]);
for (const r of resultats) {
  if (r.status === "rejected") console.error(r.reason.message);
}
const toutes = resultats.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

if (toutes.length === 0) {
  // Aucune source n'a répondu : on garde le fichier existant (données d'exemple).
  console.log("Aucune offre récupérée, data/offres.json reste inchangé.");
  process.exit(0);
}

const offres = dedoublonner(toutes.filter((o) => o.categorie))
  .sort((a, b) => new Date(b.date) - new Date(a.date));

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(
  OUTPUT,
  JSON.stringify({ miseAJour: new Date().toISOString(), exemple: false, offres }, null, 2),
);
console.log(`${offres.length} offres enregistrées dans data/offres.json.`);
