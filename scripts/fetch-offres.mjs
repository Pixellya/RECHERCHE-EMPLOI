// Récupère les dernières offres d'emploi en événementiel et communication
// depuis des sources officielles (API), puis les enregistre dans data/offres.json.
//
// Sources (chacune est isolée : si elle échoue ou n'a pas de clé, les autres continuent) :
//   - France Travail : FRANCE_TRAVAIL_CLIENT_ID, FRANCE_TRAVAIL_CLIENT_SECRET
//   - Adzuna         : ADZUNA_APP_ID, ADZUNA_APP_KEY
//   - Jooble         : JOOBLE_API_KEY
//   - APEC et Welcome to the Jungle : recherches publiques de leurs sites, sans clé
//   - Indeed et LinkedIn : fichier data/offres_jobspy.json écrit avant par
//     scripts/offres_jobspy.py (JobSpy)
//
// Filtres appliqués : Île-de-France uniquement, CDI et CDD uniquement.
//
// Lancement : node scripts/fetch-offres.mjs

import { writeFile, mkdir, readFile } from "node:fs/promises";

const OUTPUT = new URL("../data/offres.json", import.meta.url);
const JOURS = 14; // ancienneté maximale des offres conservées

// Codes métiers ROME de France Travail, classés par catégorie.
const ROME = {
  "Événementiel": ["E1107", "L1302", "L1509"],
  "Communication": ["E1103", "E1101", "E1401", "E1402"],
};

const MOTS_CLES = {
  "Événementiel": ["événementiel", "évènementiel", "evenementiel", "événement", "évènement", "evenement", "salon", "séminaire", "festival", "régie", "event", "congrès"],
  "Communication": ["communication", "community manager", "relations presse", "attaché de presse", "attachée de presse", "chargé de com", "marketing digital", "réseaux sociaux", "brand content"],
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

// ---------- Outils communs aux nouvelles sources ----------

const RECHERCHES = ["événementiel", "chef de projet événementiel", "chargé de communication", "chargée de communication"];
const EXCLUS = /\b(stage|stagiaire|altern|apprenti|freelance|ind[ée]pendant|int[ée]rim)/i;
const IDF_TEXTE = /paris|[iî]le-de-france|hauts-de-seine|seine-saint-denis|val-de-marne|yvelines|essonne|val-d.oise|seine-et-marne|\b(75|77|78|91|92|93|94|95)\d{3}\b/i;
const depuisJours = (jours) => Date.now() - jours * 86400000;

function contratDansTexte(texte) {
  if (/\bCDD\b/i.test(texte ?? "")) return "CDD";
  if (/\bCDI\b/i.test(texte ?? "")) return "CDI";
  return null;
}

// Garde une offre si elle est récente, pertinente et pas un stage, une alternance ou du freelance.
function retenir(o) {
  return o.titre && o.url && o.categorie && !EXCLUS.test(o.titre) &&
    (!o.contrat || CONTRATS.includes(o.contrat)) &&
    new Date(o.date).getTime() >= depuisJours(JOURS);
}

// ---------- APEC (recherche publique du site) ----------

async function apec() {
  const CONTRATS_APEC = { 101888: "CDI", 101887: "CDD" };
  const offres = [];
  for (const motsCles of RECHERCHES) {
    const res = await fetch("https://www.apec.fr/cms/webservices/rechercheOffre", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        typeClient: "CADRE",
        activeFiltre: true,
        sorts: [{ type: "DATE", direction: "DESCENDING" }],
        pagination: { range: 50, startIndex: 0 },
        lieux: DEPARTEMENTS_IDF,
        motsCles,
      }),
    });
    if (!res.ok) throw new Error(`APEC : HTTP ${res.status}`);
    const { resultats = [] } = await res.json();
    for (const o of resultats) {
      const titre = o.intitule ?? "";
      offres.push({
        id: `apec-${o.numeroOffre}`,
        titre,
        entreprise: o.nomCommercial ?? null,
        lieu: o.lieuTexte ?? null,
        contrat: CONTRATS_APEC[o.typeContrat] ?? contratDansTexte(`${o.typeContratLibelle ?? ""} ${titre}`),
        public: secteurPublic(o.nomCommercial),
        date: o.datePublication,
        categorie: categorie(titre),
        source: "APEC",
        url: `https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/${o.numeroOffre}`,
      });
    }
  }
  const retenues = offres.filter(retenir);
  console.log(`APEC : ${retenues.length} offres.`);
  return retenues;
}

// ---------- Welcome to the Jungle (index de recherche public Algolia) ----------

async function welcomeToTheJungle() {
  const APP = process.env.WTTJ_ALGOLIA_APP ?? "CSEKHVMS53";
  const CLE = process.env.WTTJ_ALGOLIA_KEY ?? "4bd8f6215d0cc52b26430765769e65a0";
  const INDEX = ["wttj_jobs_production_fr", "wk_cms_jobs_production"];
  const CONTRATS_WTTJ = { full_time: "CDI", temporary: "CDD" };

  async function chercher(index, query) {
    const res = await fetch(`https://${APP.toLowerCase()}-dsn.algolia.net/1/indexes/${index}/query`, {
      method: "POST",
      headers: {
        "X-Algolia-Application-Id": APP,
        "X-Algolia-API-Key": CLE,
        "Content-Type": "application/json",
        Referer: "https://www.welcometothejungle.com/",
      },
      body: JSON.stringify({
        query,
        hitsPerPage: 50,
        facetFilters: [["offices.country_code:FR"]],
        numericFilters: [`published_at_timestamp>=${Math.floor(depuisJours(JOURS) / 1000)}`],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).hits ?? [];
  }

  const offres = [];
  for (const query of RECHERCHES) {
    let hits = null;
    for (const index of INDEX) {
      try {
        hits = await chercher(index, query);
        break;
      } catch (e) {
        console.log(`Welcome to the Jungle (${index}) : ${e.message}`);
      }
    }
    if (!hits) throw new Error("Welcome to the Jungle : index de recherche indisponible.");
    for (const h of hits) {
      const bureaux = h.offices ?? [];
      const bureau = bureaux.find((b) => IDF_TEXTE.test(`${b.city ?? ""} ${b.state ?? ""} ${b.zip_code ?? ""}`));
      if (!bureau) continue;
      const contrat = CONTRATS_WTTJ[h.contract_type];
      if (!contrat) continue;
      offres.push({
        id: `wttj-${h.reference ?? h.slug}`,
        titre: h.name,
        entreprise: h.organization?.name ?? null,
        lieu: bureau.city ?? null,
        contrat,
        public: false,
        date: h.published_at,
        categorie: categorie(h.name ?? ""),
        source: "Welcome to the Jungle",
        url: `https://www.welcometothejungle.com/fr/companies/${h.organization?.slug}/jobs/${h.slug}`,
      });
    }
  }
  const retenues = offres.filter(retenir);
  console.log(`Welcome to the Jungle : ${retenues.length} offres.`);
  return retenues;
}

// ---------- Jooble (API officielle, clé gratuite) ----------

async function jooble() {
  const cle = process.env.JOOBLE_API_KEY;
  if (!cle) {
    console.log("Jooble : clé absente, source ignorée.");
    return [];
  }
  const offres = [];
  for (const keywords of RECHERCHES) {
    const res = await fetch(`https://fr.jooble.org/api/${cle}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords, location: "Île-de-France", page: 1 }),
    });
    if (!res.ok) throw new Error(`Jooble : HTTP ${res.status}`);
    const { jobs = [] } = await res.json();
    for (const o of jobs) {
      const titre = (o.title ?? "").replace(/<[^>]+>/g, "");
      offres.push({
        id: `jooble-${o.id}`,
        titre,
        entreprise: o.company || null,
        lieu: o.location ?? null,
        contrat: contratDansTexte(`${o.type ?? ""} ${titre} ${o.snippet ?? ""}`),
        public: secteurPublic(o.company),
        date: o.updated,
        categorie: categorie(titre),
        source: o.source || "Jooble",
        url: o.link,
      });
    }
  }
  const retenues = offres.filter((o) => retenir(o) && IDF_TEXTE.test(o.lieu ?? ""));
  console.log(`Jooble : ${retenues.length} offres.`);
  return retenues;
}

// ---------- Indeed et LinkedIn (fichier produit par JobSpy) ----------

async function jobspy() {
  try {
    const offres = JSON.parse(await readFile(new URL("../data/offres_jobspy.json", import.meta.url), "utf8"));
    const retenues = offres.filter(retenir);
    console.log(`Indeed et LinkedIn (JobSpy) : ${retenues.length} offres.`);
    return retenues;
  } catch {
    console.log("Indeed et LinkedIn : pas de fichier JobSpy, source ignorée.");
    return [];
  }
}

// ---------- Assemblage ----------

// Une même annonce publiée sur plusieurs sites n'est gardée qu'une fois : les sources
// sont listées par ordre de préférence, la première rencontrée l'emporte.
function dedoublonner(offres) {
  const urls = new Set();
  const vues = new Map();
  for (const o of offres) {
    if (urls.has(o.url)) continue;
    urls.add(o.url);
    const cle = `${o.titre}|${o.entreprise ?? ""}`
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/\b[hf] ?\/ ?[hf]\b/g, " ").replace(/[^a-z0-9|]+/g, " ").replace(/\s+/g, " ").replace(/ ?\| ?/, "|").trim();
    if (!vues.has(cle)) vues.set(cle, o);
  }
  return [...vues.values()];
}

const resultats = await Promise.allSettled([franceTravail(), apec(), adzuna(), jooble(), welcomeToTheJungle(), jobspy()]);
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
