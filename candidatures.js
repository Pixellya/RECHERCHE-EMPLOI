// Candidatures spontanées : profil → entreprises → préparation (contact, accroche,
// mail, CV adapté) → validation → brouillon Gmail → suivi et relances.
//
// Tout est stocké dans le navigateur (localStorage). Les services externes :
//   - Annuaire des entreprises (gratuit, sans clé)
//   - Claude (clé API Anthropic) : recherche web, rédaction du mail et du CV
//   - Gmail (identifiant client Google) : création des brouillons, jamais d'envoi
//   - Hunter (clé facultative) : recherche et vérification des adresses e-mail

import { Anthropic, jsPDF } from "./vendor/bibliotheques.js";

const MODELE = "claude-opus-5-5";
const JOURS_AVANT_RELANCE = 10;
const CLE_STOCKAGE = "candidatures-spontanees-v1";
const ANNUAIRE = "https://recherche-entreprises.api.gouv.fr/search";
const SCOPE_GMAIL = "https://www.googleapis.com/auth/gmail.compose";

// Codes d'activité (NAF) de l'annuaire, regroupés par secteur.
const SECTEURS = {
  "Événementiel": {
    "82.30Z": "Organisation de salons et congrès",
    "90.02Z": "Soutien au spectacle vivant",
    "93.29Z": "Activités récréatives et de loisirs",
  },
  "Agences de communication": {
    "73.11Z": "Agence de publicité",
    "70.21Z": "Relations publiques et communication",
    "73.12Z": "Régie publicitaire",
  },
  "Musique": {
    "59.20Z": "Enregistrement sonore et édition musicale",
    "90.01Z": "Arts du spectacle vivant",
  },
  "Culture": {
    "90.04Z": "Gestion de salles de spectacles",
    "91.02Z": "Musées",
    "90.03A": "Création artistique (arts plastiques)",
  },
  "Audiovisuel": {
    "59.11A": "Production de programmes TV",
    "59.11B": "Films institutionnels et publicitaires",
    "59.11C": "Production de films de cinéma",
    "59.12Z": "Post-production",
    "60.10Z": "Radio",
    "60.20A": "Chaînes de télévision généralistes",
    "60.20B": "Chaînes de télévision thématiques",
  },
  "Médias digitaux": {
    "63.12Z": "Portails internet",
    "58.14Z": "Édition de magazines",
    "63.91Z": "Agences de presse",
  },
};
const ACTIVITES = Object.assign({}, ...Object.values(SECTEURS));

const DEPARTEMENTS = {
  "75": "Paris", "77": "Seine-et-Marne", "78": "Yvelines", "91": "Essonne",
  "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d'Oise",
};

// Tranches d'effectif salarié de l'annuaire.
const TAILLES = {
  "1 à 9": ["01", "02", "03"],
  "10 à 49": ["11", "12"],
  "50 à 249": ["21", "22", "31"],
  "250 et plus": ["32", "41", "42", "51", "52", "53"],
};
const LIBELLES_EFFECTIF = {
  "01": "1 à 2 salariés", "02": "3 à 5 salariés", "03": "6 à 9 salariés",
  "11": "10 à 19 salariés", "12": "20 à 49 salariés", "21": "50 à 99 salariés",
  "22": "100 à 199 salariés", "31": "200 à 249 salariés", "32": "250 à 499 salariés",
  "41": "500 à 999 salariés", "42": "1 000 à 1 999 salariés", "51": "2 000 à 4 999 salariés",
  "52": "5 000 à 9 999 salariés", "53": "10 000 salariés et plus",
};

const FIABILITE = {
  verifiee: { libelle: "Vérifiée", classe: "ok", aide: "Adresse vérifiée par Hunter." },
  probable: { libelle: "Probable", classe: "moyen", aide: "Adresse nominative trouvée, mais pas vérifiée." },
  generique: { libelle: "Générique", classe: "info", aide: "Adresse générale de l'entreprise (contact@…) : elle arrive, mais pas forcément à la bonne personne." },
  supposee: { libelle: "Supposée", classe: "faible", aide: "Adresse devinée à partir du format habituel. À vérifier avant d'envoyer." },
  aucune: { libelle: "Aucune", classe: "faible", aide: "Aucune adresse trouvée : renseignez-la vous-même." },
};

const REPONSES = ["En attente", "Positive", "Négative", "Pas de réponse"];

// ---------- Données ----------

const VIDE = () => ({
  profil: {
    prenom: "", nom: "", email: "", telephone: "", ville: "", lien: "", postes: "",
    secteurs: ["Événementiel", "Agences de communication"], departements: Object.keys(DEPARTEMENTS),
    ton: "Chaleureux et direct", tonDetail: "", signature: "", cvMaitre: "", cvPdf: null,
  },
  cles: { anthropic: "", googleClientId: "", hunter: "" },
  entreprises: {}, // siren → entreprise retenue ou écartée
  candidatures: [],
});

function charger() {
  try {
    const brut = localStorage.getItem(CLE_STOCKAGE);
    if (!brut) return VIDE();
    const d = JSON.parse(brut);
    const v = VIDE();
    return { ...v, ...d, profil: { ...v.profil, ...d.profil }, cles: { ...v.cles, ...d.cles } };
  } catch {
    return VIDE();
  }
}

let donnees = charger();

function sauver() {
  try {
    localStorage.setItem(CLE_STOCKAGE, JSON.stringify(donnees));
  } catch (e) {
    alerte("Impossible d'enregistrer dans ce navigateur (" + e.message + "). Téléchargez une sauvegarde depuis Réglages.");
  }
  compteurs();
}

// ---------- Outils d'affichage ----------

const $ = (id) => document.getElementById(id);

function el(balise, attributs = {}, ...enfants) {
  const e = document.createElement(balise);
  for (const [cle, valeur] of Object.entries(attributs)) {
    if (valeur === undefined || valeur === null || valeur === false) continue;
    if (cle === "class") e.className = valeur;
    else if (cle === "texte") e.textContent = valeur;
    else if (cle.startsWith("on")) e.addEventListener(cle.slice(2), valeur);
    else if (cle in e && typeof valeur !== "string") e[cle] = valeur;
    else e.setAttribute(cle, valeur === true ? "" : valeur);
  }
  e.append(...enfants.flat().filter((x) => x !== null && x !== undefined && x !== false));
  return e;
}

function lien(texte, url) {
  return el("a", { href: url, target: "_blank", rel: "noopener", texte });
}

function alerte(message) {
  const a = $("alerte");
  a.textContent = message;
  a.hidden = !message;
  if (message) a.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function dateCourte(iso) {
  return iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
}

function ajouterJours(iso, jours) {
  const d = new Date(iso);
  d.setDate(d.getDate() + jours);
  return d.toISOString().slice(0, 10);
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);

function sansAccents(texte) {
  return (texte ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function puces(conteneur, valeurs, choisies, auChangement) {
  conteneur.replaceChildren(...valeurs.map(([valeur, libelle]) =>
    el("button", {
      type: "button",
      class: "puce" + (choisies.includes(valeur) ? " actif" : ""),
      texte: libelle,
      onclick: (ev) => {
        ev.currentTarget.classList.toggle("actif");
        const actives = [...conteneur.querySelectorAll(".puce.actif")].map((b) => b.dataset.valeur);
        auChangement(actives);
      },
      "data-valeur": valeur,
    })
  ));
}

// ---------- Onglets ----------

function onglet() {
  const nom = location.hash.slice(1) || "profil";
  document.querySelectorAll(".onglet").forEach((s) => (s.hidden = s.id !== nom));
  document.querySelectorAll("#onglets a").forEach((a) => a.classList.toggle("actif", a.dataset.onglet === nom));
  document.querySelector("#onglets a.actif")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  alerte("");
  if (nom === "entreprises") afficherRetenues();
  if (nom === "valider") afficherFiches();
  if (nom === "suivi") afficherSuivi();
}

function compteurs() {
  const n = (statuts) => donnees.candidatures.filter((c) => statuts.includes(c.statut)).length;
  $("nb-valider").textContent = n(["a_valider"]) || "";
  $("nb-suivi").textContent = n(["validee"]) || "";
  $("nb-retenues").textContent = Object.values(donnees.entreprises).filter((e) => e.statut === "retenue").length || "";
}

// ---------- 1. Profil ----------

function initProfil() {
  const form = $("form-profil");
  for (const champ of form.elements) {
    if (champ.name && champ.name in donnees.profil) champ.value = donnees.profil[champ.name];
  }
  form.addEventListener("input", (ev) => {
    if (!ev.target.name) return;
    donnees.profil[ev.target.name] = ev.target.value;
    sauver();
  });

  puces($("profil-secteurs"), Object.keys(SECTEURS).map((s) => [s, s]), donnees.profil.secteurs, (v) => {
    donnees.profil.secteurs = v;
    sauver();
    initRecherche();
  });
  puces($("profil-departements"), Object.entries(DEPARTEMENTS).map(([c, n]) => [c, `${c} ${n}`]), donnees.profil.departements, (v) => {
    donnees.profil.departements = v;
    sauver();
    initRecherche();
  });

  $("cv-pdf-nom").textContent = donnees.profil.cvPdf ? `Enregistré : ${donnees.profil.cvPdf.nom}` : "";
  $("cv-pdf").addEventListener("change", async (ev) => {
    const fichier = ev.target.files[0];
    if (!fichier) return;
    if (fichier.size > 2_000_000) return alerte("Ce PDF dépasse 2 Mo : le navigateur ne pourra pas le garder. Essayez une version compressée.");
    donnees.profil.cvPdf = { nom: fichier.name, base64: enBase64(new Uint8Array(await fichier.arrayBuffer())) };
    sauver();
    $("cv-pdf-nom").textContent = `Enregistré : ${fichier.name}`;
  });
}

// ---------- 2. Entreprises ----------

const recherche = { secteurs: [], departements: [], tailles: ["10 à 49", "50 à 249"], page: 1, resultats: [] };

function initRecherche() {
  recherche.secteurs = [...donnees.profil.secteurs];
  recherche.departements = [...donnees.profil.departements];
  puces($("recherche-secteurs"), Object.keys(SECTEURS).map((s) => [s, s]), recherche.secteurs, (v) => (recherche.secteurs = v));
  puces($("recherche-departements"), Object.entries(DEPARTEMENTS).map(([c, n]) => [c, `${c} ${n}`]), recherche.departements, (v) => (recherche.departements = v));
  puces($("recherche-tailles"), Object.keys(TAILLES).map((t) => [t, t]), recherche.tailles, (v) => (recherche.tailles = v));
}

async function appelAnnuaire(params) {
  for (let essai = 0; essai < 3; essai++) {
    const res = await fetch(`${ANNUAIRE}?${new URLSearchParams(params)}`);
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    if (!res.ok) throw new Error(`L'annuaire des entreprises a répondu ${res.status}.`);
    return res.json();
  }
  throw new Error("L'annuaire des entreprises est saturé, réessayez dans une minute.");
}

function versEntreprise(r, source) {
  const siege = r.siege ?? {};
  const code = siege.activite_principale ?? r.activite_principale;
  return {
    siren: r.siren,
    nom: r.nom_complet ?? r.nom_raison_sociale,
    activite: ACTIVITES[code] ?? code ?? "",
    ville: [siege.code_postal, siege.libelle_commune].filter(Boolean).join(" "),
    effectif: LIBELLES_EFFECTIF[r.tranche_effectif_salarie] ?? "",
    dirigeants: (r.dirigeants ?? [])
      .filter((d) => d.type_dirigeant === "personne physique")
      .slice(0, 4)
      .map((d) => ({ prenom: (d.prenoms ?? "").split(" ")[0], nom: d.nom ?? "", qualite: d.qualite ?? "" })),
    source,
  };
}

async function chercher(nouvelle) {
  if (!recherche.secteurs.length) return alerte("Choisissez au moins un secteur.");
  if (!recherche.departements.length) return alerte("Choisissez au moins un département.");
  alerte("");
  if (nouvelle) {
    recherche.page = 1;
    recherche.resultats = [];
  }
  const bouton = $("bouton-chercher");
  bouton.disabled = true;
  bouton.textContent = "Recherche…";
  try {
    const codes = recherche.secteurs.flatMap((s) => Object.keys(SECTEURS[s]));
    const params = {
      activite_principale: codes.join(","),
      departement: recherche.departements.join(","),
      etat_administratif: "A",
      est_entrepreneur_individuel: "false",
      per_page: "25",
      page: String(recherche.page),
    };
    const tranches = recherche.tailles.flatMap((t) => TAILLES[t]);
    if (tranches.length) params.tranche_effectif_salarie = tranches.join(",");
    const mot = $("recherche-mot").value.trim();
    if (mot) params.q = mot;

    const reponse = await appelAnnuaire(params);
    recherche.resultats.push(...reponse.results.map((r) => versEntreprise(r, "Annuaire")));
    recherche.total = reponse.total_results;
    recherche.pages = reponse.total_pages;
    afficherResultats();
  } catch (e) {
    alerte(e.message);
  } finally {
    bouton.disabled = false;
    bouton.textContent = "Chercher";
  }
}

async function chercherMaListe() {
  const noms = $("ma-liste").value.split("\n").map((n) => n.trim()).filter(Boolean);
  if (!noms.length) return;
  const bouton = $("bouton-ma-liste");
  bouton.disabled = true;
  recherche.resultats = [];
  recherche.pages = 0;
  const introuvables = [];
  for (const [i, nom] of noms.entries()) {
    bouton.textContent = `Recherche ${i + 1}/${noms.length}…`;
    try {
      const reponse = await appelAnnuaire({ q: nom, etat_administratif: "A", per_page: "1" });
      if (reponse.results[0]) recherche.resultats.push(versEntreprise(reponse.results[0], "Ma liste"));
      else introuvables.push(nom);
    } catch {
      introuvables.push(nom);
    }
  }
  bouton.disabled = false;
  bouton.textContent = "Chercher ces entreprises";
  recherche.total = recherche.resultats.length;
  afficherResultats();
  if (introuvables.length) alerte(`Introuvables dans l'annuaire : ${introuvables.join(", ")}.`);
}

function carteEntreprise(e, boutons) {
  const dirigeants = e.dirigeants.map((d) => `${d.prenom} ${d.nom}`.trim() + (d.qualite ? ` (${d.qualite})` : "")).join(", ");
  return el("li", { class: "offre entreprise" },
    el("div", { class: "entete" },
      el("h3", { texte: e.nom }),
      lien("Fiche officielle", `https://annuaire-entreprises.data.gouv.fr/entreprise/${e.siren}`),
    ),
    el("div", { class: "infos", texte: [e.activite, e.ville, e.effectif].filter(Boolean).join(" · ") }),
    dirigeants && el("div", { class: "infos", texte: `Dirigeants : ${dirigeants}` }),
    el("div", { class: "actions" }, boutons),
  );
}

function decider(entreprise, statut) {
  const existante = donnees.entreprises[entreprise.siren];
  donnees.entreprises[entreprise.siren] = { ...entreprise, ...existante, statut };
  sauver();
  afficherResultats();
  afficherRetenues();
}

function afficherResultats() {
  const aTrier = recherche.resultats.filter((e) => !donnees.entreprises[e.siren]);
  const dejaVues = recherche.resultats.length - aTrier.length;
  $("resultats-compteur").textContent = recherche.total === undefined ? "" :
    `${recherche.total} entreprise${recherche.total > 1 ? "s" : ""} trouvée${recherche.total > 1 ? "s" : ""}` +
    (dejaVues ? ` · ${dejaVues} déjà triée${dejaVues > 1 ? "s" : ""} masquée${dejaVues > 1 ? "s" : ""}` : "");
  $("resultats").replaceChildren(...aTrier.map((e) => carteEntreprise(e, [
    el("button", { type: "button", class: "bouton principal", texte: "Oui", onclick: () => decider(e, "retenue") }),
    el("button", { type: "button", class: "bouton", texte: "Non", onclick: () => decider(e, "ecartee") }),
  ])));
  $("bouton-plus").hidden = !(recherche.pages > recherche.page);
}

const enPreparation = new Map(); // siren → message d'avancement

function afficherRetenues() {
  const retenues = Object.values(donnees.entreprises).filter((e) => e.statut === "retenue");
  $("bouton-tout-preparer").hidden = retenues.length === 0;
  $("retenues").replaceChildren(...retenues.map((e) => {
    const avancement = enPreparation.get(e.siren);
    return carteEntreprise(e, [
      avancement
        ? el("span", { class: "avancement", texte: avancement })
        : el("button", { type: "button", class: "bouton principal", texte: "Préparer", onclick: () => preparerUne(e.siren) }),
      !avancement && el("button", { type: "button", class: "bouton", texte: "Retirer", onclick: () => decider(e, "ecartee") }),
      e.erreur && el("span", { class: "erreur", texte: e.erreur }),
    ]);
  }));
  if (!retenues.length) $("retenues").append(el("li", { class: "vide", texte: "Aucune entreprise retenue pour l'instant." }));
  compteurs();
}

// ---------- Claude ----------

function claude() {
  if (!donnees.cles.anthropic) throw new Error("Ajoutez votre clé API Claude dans Réglages.");
  return new Anthropic({ apiKey: donnees.cles.anthropic, dangerouslyAllowBrowser: true });
}

async function appelClaude(params) {
  const client = claude();
  let messages = params.messages;
  for (let tour = 0; tour < 4; tour++) {
    const reponse = await client.beta.messages.create({
      model: MODELE,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      ...params,
      messages,
    });
    if (reponse.stop_reason === "refusal") throw new Error("Claude a refusé de traiter cette demande.");
    if (reponse.stop_reason === "pause_turn") {
      messages = [...messages, { role: "assistant", content: reponse.content }];
      continue;
    }
    return reponse.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  }
  throw new Error("La recherche a pris trop de temps, réessayez.");
}

function messageErreur(e) {
  if (e instanceof Anthropic.AuthenticationError) return "Clé API Claude refusée : vérifiez-la dans Réglages.";
  if (e instanceof Anthropic.RateLimitError) return "Trop de demandes à Claude d'un coup : patientez une minute.";
  if (e instanceof Anthropic.APIConnectionError) return "Impossible de joindre Claude : vérifiez votre connexion.";
  if (e instanceof Anthropic.APIError) return `Erreur Claude : ${e.message}`;
  return e.message;
}

function descriptionEntreprise(e) {
  const dirigeants = e.dirigeants.map((d) => `${d.prenom} ${d.nom} (${d.qualite || "dirigeant"})`).join(", ");
  return [
    `Entreprise : ${e.nom} (SIREN ${e.siren})`,
    `Activité : ${e.activite}`,
    `Siège : ${e.ville}`,
    e.effectif && `Effectif : ${e.effectif}`,
    dirigeants && `Dirigeants déclarés à l'annuaire officiel : ${dirigeants}`,
  ].filter(Boolean).join("\n");
}

async function rechercherEntreprise(e) {
  const p = donnees.profil;
  return appelClaude({
    output_config: { effort: "medium" },
    tools: [{
      type: "web_search_20260209",
      name: "web_search",
      max_uses: 6,
      user_location: { type: "approximate", country: "FR", city: "Paris", timezone: "Europe/Paris" },
    }],
    system: "Tu prépares une candidature spontanée pour une personne qui cherche un emploi. Tu fais des recherches sur le web et tu rends des notes factuelles en français. Tu n'inventes jamais un nom, une adresse e-mail ou un fait : si tu ne trouves pas, tu l'écris.",
    messages: [{
      role: "user",
      content: `${descriptionEntreprise(e)}

Postes visés par la personne : ${p.postes || "communication, événementiel"}

Cherche sur le web et note, avec l'URL source de chaque information :
1. Le site officiel de l'entreprise et son nom de domaine.
2. Une à trois actualités récentes (12 derniers mois de préférence) qui peuvent servir d'accroche : festival ou événement lancé, nouveau client, campagne, ouverture de bureau, prix, développement, recrutement… Donne la date.
3. La personne la plus pertinente à qui écrire pour ces postes : direction de la communication, de l'événementiel, de la production, ou RH dans une grande structure. Dans une petite structure, le dirigeant. Donne son nom, son poste et la source. Si tu ne trouves personne de vérifiable, propose le dirigeant de l'annuaire officiel et dis-le.
4. Toute adresse e-mail publiée (page contact, mentions légales, article, offre d'emploi) avec la source, et le format des adresses de l'entreprise s'il est visible (ex. prenom.nom@domaine).`,
    }],
  });
}

const SCHEMA_CANDIDATURE = {
  type: "object",
  additionalProperties: false,
  required: ["site", "domaine", "contact", "email_publie", "format_email", "angle", "mail", "cv"],
  properties: {
    site: { type: "string", description: "URL du site officiel, ou chaîne vide" },
    domaine: { type: "string", description: "Nom de domaine des adresses e-mail (ex. agence.fr), ou chaîne vide" },
    contact: {
      type: "object",
      additionalProperties: false,
      required: ["prenom", "nom", "poste", "source", "pourquoi"],
      properties: {
        prenom: { type: "string" },
        nom: { type: "string" },
        poste: { type: "string" },
        source: { type: "string", description: "URL où la personne est mentionnée, ou « Annuaire des entreprises »" },
        pourquoi: { type: "string", description: "Une phrase : pourquoi cette personne" },
      },
    },
    email_publie: {
      type: "object",
      additionalProperties: false,
      required: ["adresse", "source", "type"],
      properties: {
        adresse: { type: "string", description: "Adresse trouvée publiée telle quelle, ou chaîne vide" },
        source: { type: "string" },
        type: { type: "string", enum: ["nominative", "generique", "aucune"] },
      },
    },
    format_email: { type: "string", enum: ["prenom.nom", "p.nom", "pnom", "prenom", "nom", "prenomnom", "inconnu"] },
    angle: {
      type: "object",
      additionalProperties: false,
      required: ["accroche", "sources"],
      properties: {
        accroche: { type: "string", description: "Le fait précis et récent qui sert d'accroche, en une ou deux phrases" },
        sources: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["titre", "url", "date"],
            properties: { titre: { type: "string" }, url: { type: "string" }, date: { type: "string" } },
          },
        },
      },
    },
    mail: {
      type: "object",
      additionalProperties: false,
      required: ["objet", "corps"],
      properties: {
        objet: { type: "string" },
        corps: { type: "string", description: "Corps du mail, de la formule d'appel à la formule de politesse, sans signature" },
      },
    },
    cv: {
      type: "object",
      additionalProperties: false,
      required: ["titre", "accroche", "experiences", "competences", "formation", "autres"],
      properties: {
        titre: { type: "string", description: "Titre du CV, adapté au poste visé dans cette entreprise" },
        accroche: { type: "string", description: "Deux ou trois lignes de présentation" },
        experiences: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["poste", "structure", "lieu", "dates", "points"],
            properties: {
              poste: { type: "string" },
              structure: { type: "string" },
              lieu: { type: "string" },
              dates: { type: "string" },
              points: { type: "array", items: { type: "string" } },
            },
          },
        },
        competences: { type: "array", items: { type: "string" } },
        formation: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["diplome", "etablissement", "dates"],
            properties: { diplome: { type: "string" }, etablissement: { type: "string" }, dates: { type: "string" } },
          },
        },
        autres: { type: "array", items: { type: "string" }, description: "Langues, logiciels, centres d'intérêt…" },
      },
    },
  },
};

async function rediger(e, notes) {
  const p = donnees.profil;
  const texte = await appelClaude({
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA_CANDIDATURE } },
    system: `Tu rédiges des candidatures spontanées courtes et précises, en français.

Règles absolues :
- Tu n'inventes rien. Le mail et le CV ne reprennent que des faits présents dans le CV maître (expériences, dates, chiffres, compétences, diplômes). Les informations sur l'entreprise viennent uniquement des notes de recherche.
- Le contact, l'adresse e-mail et les sources viennent uniquement des notes de recherche ou de l'annuaire.

Le mail :
- 120 à 180 mots, vouvoiement, formule d'appel au nom du contact (« Bonjour Madame X, » ou « Bonjour Monsieur X, », ou « Bonjour, » si le genre n'est pas clair).
- Premier paragraphe : l'accroche, un fait précis et récent sur l'entreprise, et le lien avec la démarche.
- Deuxième paragraphe : ce que la personne apporte, avec une ou deux expériences concrètes du CV en rapport avec l'entreprise.
- Troisième paragraphe : proposer un échange court, mentionner le CV en pièce jointe.
- Pas de formules creuses (« dynamique et motivé », « je me permets de »), pas de flatterie.
- Pas de signature : elle est ajoutée automatiquement.
- Ton : ${p.ton}.${p.tonDetail ? " " + p.tonDetail : ""}
- Objet court et spécifique à l'entreprise.

Le CV adapté :
- Choisis et ordonne les expériences les plus pertinentes pour cette entreprise ; tu peux en laisser de côté.
- Tu peux reformuler les missions pour mettre en avant ce qui compte ici, sans ajouter de fait. Garde les dates exactes.`,
    messages: [{
      role: "user",
      content: `${descriptionEntreprise(e)}

<notes_de_recherche>
${notes}
</notes_de_recherche>

Postes visés : ${p.postes || "communication, événementiel"}
Ville de la personne : ${p.ville || "Île-de-France"}

<cv_maitre>
${p.cvMaitre}
</cv_maitre>`,
    }],
  });
  return JSON.parse(texte);
}

// ---------- Adresse e-mail ----------

function partieAdresse(texte) {
  return sansAccents(texte).toLowerCase().replace(/[^a-z-]/g, "");
}

function devinerAdresse(prenom, nom, domaine, format) {
  const p = partieAdresse(prenom);
  const n = partieAdresse(nom);
  if (!p || !n || !domaine) return "";
  const local = {
    "prenom.nom": `${p}.${n}`, "p.nom": `${p[0]}.${n}`, pnom: `${p[0]}${n}`,
    prenom: p, nom: n, prenomnom: `${p}${n}`,
  }[format] ?? `${p}.${n}`;
  return `${local}@${domaine}`;
}

async function hunter(prenom, nom, domaine) {
  const params = new URLSearchParams({ domain: domaine, first_name: prenom, last_name: nom, api_key: donnees.cles.hunter });
  const res = await fetch(`https://api.hunter.io/v2/email-finder?${params}`);
  if (!res.ok) return null;
  const { data } = await res.json();
  return data?.email ? { email: data.email, score: data.score ?? 0, statut: data.verification?.status } : null;
}

async function trouverAdresse(r) {
  const { contact, domaine, email_publie: publie, format_email: format } = r;
  if (donnees.cles.hunter && domaine && contact.nom) {
    try {
      const h = await hunter(contact.prenom, contact.nom, domaine);
      if (h) {
        const fiabilite = h.statut === "valid" && h.score >= 80 ? "verifiee" : h.score >= 50 ? "probable" : "supposee";
        return { email: h.email, fiabilite, detail: `Hunter, score ${h.score}/100` };
      }
    } catch {
      // Hunter indisponible : on continue avec les autres pistes.
    }
  }
  const nominatif = publie.type === "nominative" && publie.adresse;
  if (nominatif) return { email: publie.adresse, fiabilite: "probable", detail: `Publiée : ${publie.source}` };
  const devinee = devinerAdresse(contact.prenom, contact.nom, domaine, format);
  if (devinee) {
    return {
      email: devinee,
      fiabilite: "supposee",
      detail: format === "inconnu" ? "Format prenom.nom supposé" : `Format ${format} repéré sur le web`,
      generique: publie.type === "generique" ? publie.adresse : "",
    };
  }
  if (publie.adresse) return { email: publie.adresse, fiabilite: "generique", detail: `Publiée : ${publie.source}` };
  return { email: "", fiabilite: "aucune", detail: "" };
}

// ---------- Préparation ----------

function avancer(siren, message) {
  if (message) enPreparation.set(siren, message);
  else enPreparation.delete(siren);
  afficherRetenues();
}

async function preparerUne(siren) {
  const e = donnees.entreprises[siren];
  if (!e || enPreparation.has(siren)) return;
  if (!donnees.profil.cvMaitre.trim()) {
    alerte("Collez d'abord votre CV maître dans l'onglet Profil.");
    return false;
  }
  delete e.erreur;
  try {
    claude();
    avancer(siren, "Recherche de l'entreprise et du contact…");
    const notes = await rechercherEntreprise(e);
    avancer(siren, "Rédaction du mail et du CV…");
    const r = await rediger(e, notes);
    avancer(siren, "Recherche de l'adresse e-mail…");
    const adresse = await trouverAdresse(r);

    const ancienne = donnees.candidatures.find((c) => c.siren === siren && c.statut === "a_valider");
    const candidature = {
      id: ancienne?.id ?? crypto.randomUUID(),
      siren,
      entreprise: { nom: e.nom, activite: e.activite, ville: e.ville, site: r.site },
      contact: { prenom: r.contact.prenom, nom: r.contact.nom, poste: r.contact.poste, source: r.contact.source, pourquoi: r.contact.pourquoi, ...adresse },
      angle: r.angle,
      mail: r.mail,
      cv: { ...r.cv, experiences: r.cv.experiences.map((x) => ({ ...x, garder: true })) },
      pieceJointe: "adapte",
      statut: "a_valider",
      prepareLe: new Date().toISOString(),
    };
    donnees.candidatures = donnees.candidatures.filter((c) => c.id !== candidature.id);
    donnees.candidatures.push(candidature);
    e.statut = "preparee";
    sauver();
    return true;
  } catch (err) {
    e.erreur = messageErreur(err);
    sauver();
    return false;
  } finally {
    avancer(siren, null);
  }
}

async function toutPreparer() {
  const bouton = $("bouton-tout-preparer");
  bouton.disabled = true;
  const sirens = Object.values(donnees.entreprises).filter((e) => e.statut === "retenue").map((e) => e.siren);
  let reussies = 0;
  for (const siren of sirens) {
    const ok = await preparerUne(siren);
    if (ok === false && !donnees.profil.cvMaitre.trim()) break;
    if (ok) reussies++;
  }
  bouton.disabled = false;
  if (reussies) alerte(`${reussies} candidature${reussies > 1 ? "s" : ""} prête${reussies > 1 ? "s" : ""} à valider dans l'onglet 3.`);
}

// ---------- CV en PDF ----------

function texteWinAnsi(texte) {
  // Les polices intégrées du PDF ne connaissent pas certains caractères.
  return (texte ?? "")
    .replace(/[‐-–]/g, "-")
    .replace(/—/g, "–")
    .replace(/[  ]/g, " ")
    .replace(/[→⇒]/g, "->")
    .replace(/[^\x00-\xffŒœ–‘’“”•…€]/g, "");
}

function genererCv(c) {
  const p = donnees.profil;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const marge = 18;
  const largeur = 210 - 2 * marge;
  let y = 20;

  const ligne = (texte, { taille = 10, style = "normal", couleur = [31, 29, 26], avant = 0, retrait = 0, interligne = 1.35 } = {}) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(taille);
    doc.setTextColor(...couleur);
    const lignes = doc.splitTextToSize(texteWinAnsi(texte), largeur - retrait);
    y += avant;
    for (const l of lignes) {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(l, marge + retrait, y);
      y += taille * 0.3528 * interligne;
    }
  };
  const section = (titre) => {
    ligne(titre.toUpperCase(), { taille: 10, style: "bold", couleur: [194, 65, 12], avant: 5 });
    doc.setDrawColor(230, 225, 216);
    doc.line(marge, y - 3, marge + largeur, y - 3);
    y += 1;
  };

  ligne(`${p.prenom} ${p.nom}`.trim() || "Votre nom", { taille: 20, style: "bold" });
  ligne(c.cv.titre, { taille: 12, couleur: [194, 65, 12], avant: 1 });
  ligne([p.email, p.telephone, p.ville, p.lien].filter(Boolean).join("  ·  "), { taille: 9, couleur: [107, 102, 94], avant: 1 });
  if (c.cv.accroche) ligne(c.cv.accroche, { avant: 4 });

  const experiences = c.cv.experiences.filter((x) => x.garder);
  if (experiences.length) {
    section("Expériences");
    for (const x of experiences) {
      ligne(`${x.poste} - ${x.structure}`, { style: "bold", avant: 2 });
      ligne([x.dates, x.lieu].filter(Boolean).join(" · "), { taille: 9, couleur: [107, 102, 94] });
      for (const point of x.points) ligne(`•  ${point}`, { retrait: 3, avant: 0.5 });
    }
  }
  if (c.cv.competences.length) {
    section("Compétences");
    ligne(c.cv.competences.join("  ·  "));
  }
  if (c.cv.formation.length) {
    section("Formation");
    for (const f of c.cv.formation) {
      ligne(f.diplome, { style: "bold", avant: 1 });
      ligne([f.etablissement, f.dates].filter(Boolean).join(" · "), { taille: 9, couleur: [107, 102, 94] });
    }
  }
  if (c.cv.autres.length) {
    section("Et aussi");
    ligne(c.cv.autres.join("  ·  "));
  }
  return doc;
}

function nomFichierCv() {
  const p = donnees.profil;
  return `CV-${partieAdresse(p.prenom) || "prenom"}-${partieAdresse(p.nom) || "nom"}.pdf`.replace(/-+/g, "-");
}

function pieceJointe(c) {
  if (c.pieceJointe === "origine" && donnees.profil.cvPdf) {
    return { nom: donnees.profil.cvPdf.nom, base64: donnees.profil.cvPdf.base64 };
  }
  const octets = new Uint8Array(genererCv(c).output("arraybuffer"));
  return { nom: nomFichierCv(), base64: enBase64(octets) };
}

function apercuCv(c) {
  const pj = pieceJointe(c);
  const octets = Uint8Array.from(atob(pj.base64), (x) => x.charCodeAt(0));
  window.open(URL.createObjectURL(new Blob([octets], { type: "application/pdf" })), "_blank");
}

// ---------- Gmail ----------

function enBase64(octets) {
  let binaire = "";
  for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(binaire);
}

const base64Texte = (texte) => enBase64(new TextEncoder().encode(texte));
const enteteUtf8 = (texte) => `=?UTF-8?B?${base64Texte(texte)}?=`;
const coupe76 = (b64) => b64.replace(/.{76}/g, "$&\r\n");

function messageMime({ a, objet, corps, pj }) {
  const frontiere = "frontiere-" + crypto.randomUUID();
  const parties = [
    `To: ${a}`,
    `Subject: ${enteteUtf8(objet)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${frontiere}"`,
    "",
    `--${frontiere}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    coupe76(base64Texte(corps)),
  ];
  if (pj) {
    const nom = sansAccents(pj.nom).replace(/[^\w.-]/g, "_");
    parties.push(
      `--${frontiere}`,
      `Content-Type: application/pdf; name="${nom}"`,
      `Content-Disposition: attachment; filename="${nom}"`,
      "Content-Transfer-Encoding: base64",
      "",
      coupe76(pj.base64),
    );
  }
  parties.push(`--${frontiere}--`, "");
  return enBase64(new TextEncoder().encode(parties.join("\r\n"))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let jetonGmail = null; // { valeur, expire }

function connecterGmail() {
  return new Promise((resoudre, rejeter) => {
    if (jetonGmail && jetonGmail.expire > Date.now() + 60_000) return resoudre(jetonGmail.valeur);
    if (!donnees.cles.googleClientId) return rejeter(new Error("Ajoutez votre identifiant client Google dans Réglages."));
    if (!window.google?.accounts?.oauth2) return rejeter(new Error("Le service de connexion Google n'est pas chargé. Rechargez la page."));
    const client = google.accounts.oauth2.initTokenClient({
      client_id: donnees.cles.googleClientId,
      scope: SCOPE_GMAIL,
      callback: (r) => {
        if (r.error) return rejeter(new Error(`Connexion Gmail refusée (${r.error}).`));
        jetonGmail = { valeur: r.access_token, expire: Date.now() + r.expires_in * 1000 };
        $("etat-gmail").textContent = "Gmail connecté.";
        resoudre(r.access_token);
      },
      error_callback: (r) => rejeter(new Error(`Connexion Gmail interrompue (${r.type}).`)),
    });
    client.requestAccessToken();
  });
}

// Crée un brouillon. N'envoie jamais rien : l'envoi se fait à la main depuis Gmail.
async function creerBrouillon({ a, objet, corps, pj, filDiscussion }) {
  const jeton = await connecterGmail();
  const message = { raw: messageMime({ a, objet, corps, pj }) };
  if (filDiscussion) message.threadId = filDiscussion;
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (res.status === 401) {
    jetonGmail = null;
    throw new Error("Session Gmail expirée : cliquez à nouveau pour vous reconnecter.");
  }
  if (!res.ok) throw new Error(`Gmail a refusé le brouillon (${res.status}).`);
  const d = await res.json();
  return { id: d.id, messageId: d.message.id, filDiscussion: d.message.threadId };
}

const lienBrouillon = (messageId) => `https://mail.google.com/mail/u/0/#drafts?compose=${messageId}`;

function corpsComplet(corps) {
  const signature = donnees.profil.signature.trim();
  return signature ? `${corps.trim()}\n\n${signature}` : corps.trim();
}

// ---------- 3. Fiches à valider ----------

function champ(libelle, valeur, auChangement, { multi = false, rows = 8, type = "text" } = {}) {
  const saisie = multi
    ? el("textarea", { rows: String(rows), oninput: (ev) => auChangement(ev.target.value) })
    : el("input", { type, oninput: (ev) => auChangement(ev.target.value) });
  saisie.value = valeur ?? "";
  return el("label", {}, libelle, saisie);
}

function badgeFiabilite(contact) {
  const f = FIABILITE[contact.fiabilite] ?? FIABILITE.aucune;
  return el("span", { class: `fiabilite ${f.classe}`, title: f.aide, texte: f.libelle });
}

function fiche(c) {
  const modifier = (fn) => {
    fn();
    sauver();
  };
  const ct = c.contact;
  const cv = c.cv;

  const blocCv = el("div", { class: "bloc-cv", hidden: c.pieceJointe === "origine" },
    champ("Titre du CV", cv.titre, (v) => modifier(() => (cv.titre = v))),
    champ("Accroche", cv.accroche, (v) => modifier(() => (cv.accroche = v)), { multi: true, rows: 3 }),
    el("p", { class: "infos", texte: "Expériences mises en avant (décochez pour retirer, une mission par ligne) :" }),
    cv.experiences.map((x) => {
      const coche = el("input", { type: "checkbox", checked: x.garder, onchange: (ev) => modifier(() => (x.garder = ev.target.checked)) });
      const points = el("textarea", { rows: String(Math.max(2, x.points.length)), oninput: (ev) => modifier(() => (x.points = ev.target.value.split("\n").filter((l) => l.trim()))) });
      points.value = x.points.join("\n");
      return el("div", { class: "experience" },
        el("label", { class: "case" }, coche, el("strong", { texte: `${x.poste} - ${x.structure}` }), el("span", { class: "infos", texte: x.dates })),
        points,
      );
    }),
    champ("Compétences (séparées par des virgules)", cv.competences.join(", "), (v) => modifier(() => (cv.competences = v.split(",").map((s) => s.trim()).filter(Boolean)))),
  );

  const choixPj = el("div", { class: "puces" },
    [["adapte", "CV adapté (généré)"], ["origine", "Mon CV PDF d'origine"]].map(([valeur, libelle]) =>
      el("button", {
        type: "button",
        class: "puce" + (c.pieceJointe === valeur ? " actif" : ""),
        texte: libelle,
        disabled: valeur === "origine" && !donnees.profil.cvPdf,
        title: valeur === "origine" && !donnees.profil.cvPdf ? "Ajoutez votre CV PDF dans l'onglet Profil" : undefined,
        onclick: (ev) => {
          modifier(() => (c.pieceJointe = valeur));
          ev.currentTarget.parentElement.querySelectorAll(".puce").forEach((b) => b.classList.toggle("actif", b === ev.currentTarget));
          blocCv.hidden = valeur === "origine";
        },
      })
    ),
  );

  const etat = el("p", { class: "infos" });
  const valider = el("button", {
    type: "button",
    class: "bouton principal",
    texte: "Valider → brouillon Gmail",
    onclick: async (ev) => {
      if (!ct.email) return (etat.textContent = "Renseignez l'adresse e-mail du contact.");
      const bouton = ev.currentTarget;
      bouton.disabled = true;
      etat.textContent = "Création du brouillon…";
      try {
        const b = await creerBrouillon({ a: ct.email, objet: c.mail.objet, corps: corpsComplet(c.mail.corps), pj: pieceJointe(c) });
        modifier(() => Object.assign(c, { statut: "validee", brouillon: b, valideeLe: new Date().toISOString(), reponse: "En attente" }));
        afficherFiches();
        alerte(`Brouillon créé pour ${c.entreprise.nom}. Relisez-le dans Gmail puis cliquez vous-même sur « Envoyer ».`);
      } catch (err) {
        etat.textContent = err.message;
        bouton.disabled = false;
      }
    },
  });

  const sansGmail = el("button", {
    type: "button",
    class: "bouton",
    texte: "Sans Gmail : télécharger le CV et ouvrir le mail",
    onclick: () => {
      const pj = pieceJointe(c);
      const a = el("a", { href: `data:application/pdf;base64,${pj.base64}`, download: pj.nom });
      a.click();
      location.href = `mailto:${encodeURIComponent(ct.email)}?subject=${encodeURIComponent(c.mail.objet)}&body=${encodeURIComponent(corpsComplet(c.mail.corps))}`;
      modifier(() => Object.assign(c, { statut: "validee", valideeLe: new Date().toISOString(), reponse: "En attente" }));
      afficherFiches();
    },
  });

  return el("li", { class: "offre fiche" },
    el("div", { class: "entete" },
      el("h3", { texte: c.entreprise.nom }),
      c.entreprise.site && lien("Site", c.entreprise.site),
    ),
    el("div", { class: "infos", texte: [c.entreprise.activite, c.entreprise.ville].filter(Boolean).join(" · ") }),

    el("h4", { texte: "Contact" }),
    el("div", { class: "deux" },
      champ("Prénom", ct.prenom, (v) => modifier(() => (ct.prenom = v))),
      champ("Nom", ct.nom, (v) => modifier(() => (ct.nom = v))),
      champ("Poste", ct.poste, (v) => modifier(() => (ct.poste = v))),
      el("label", {}, el("span", {}, "E-mail ", badgeFiabilite(ct)),
        (() => {
          const i = el("input", { type: "email", oninput: (ev) => modifier(() => (ct.email = ev.target.value)) });
          i.value = ct.email;
          return i;
        })()),
    ),
    el("p", { class: "infos" },
      [ct.pourquoi, ct.detail].filter(Boolean).join(" · "),
      ct.source?.startsWith("http") ? [" · ", lien("source", ct.source)] : ct.source ? ` · ${ct.source}` : "",
      ct.generique ? ` · Adresse générale de repli : ${ct.generique}` : "",
    ),

    el("h4", { texte: "Angle" }),
    el("p", { texte: c.angle.accroche }),
    c.angle.sources.length > 0 && el("ul", { class: "sources" },
      c.angle.sources.map((s) => el("li", {}, lien(s.titre || s.url, s.url), s.date ? ` (${s.date})` : "")),
    ),

    el("h4", { texte: "Mail" }),
    champ("Objet", c.mail.objet, (v) => modifier(() => (c.mail.objet = v))),
    champ("Message (la signature du profil est ajoutée à la fin)", c.mail.corps, (v) => modifier(() => (c.mail.corps = v)), { multi: true, rows: 12 }),

    el("h4", { texte: "CV joint" }),
    choixPj,
    blocCv,
    el("button", { type: "button", class: "bouton", texte: "Aperçu du CV", onclick: () => apercuCv(c) }),

    el("div", { class: "actions validation" },
      valider,
      el("button", {
        type: "button", class: "bouton", texte: "Refaire la recherche",
        onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          etat.textContent = "Nouvelle recherche en cours (une à deux minutes)…";
          const e = donnees.entreprises[c.siren];
          if (e) e.statut = "retenue";
          const ok = await preparerUne(c.siren);
          if (!ok && e) {
            e.statut = "preparee";
            sauver();
          }
          afficherFiches();
          if (!ok) alerte(e?.erreur ?? "La préparation a échoué.");
        },
      }),
      el("button", {
        type: "button", class: "bouton danger", texte: "Rejeter",
        onclick: () => {
          modifier(() => (c.statut = "rejetee"));
          afficherFiches();
        },
      }),
    ),
    el("details", { class: "repli" }, el("summary", { texte: "Pas de Gmail ?" }), sansGmail),
    etat,
  );
}

function afficherFiches() {
  const aValider = donnees.candidatures.filter((c) => c.statut === "a_valider");
  $("fiches").replaceChildren(...aValider.map(fiche));
  if (!aValider.length) $("fiches").append(el("li", { class: "vide", texte: "Rien à valider. Retenez des entreprises dans l'onglet 2 puis lancez la préparation." }));
  compteurs();
}

// ---------- 4. Suivi ----------

async function redigerRelance(c) {
  const p = donnees.profil;
  return JSON.parse(await appelClaude({
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["corps"],
          properties: { corps: { type: "string", description: "Corps de la relance, sans signature" } },
        },
      },
    },
    system: `Tu rédiges une relance courte (50 à 80 mots), polie et sans reproche, pour une candidature spontanée restée sans réponse. Vouvoiement. Ton : ${p.ton}. Pas de signature. N'invente rien.`,
    messages: [{
      role: "user",
      content: `Contact : ${c.contact.prenom} ${c.contact.nom}, ${c.contact.poste}, ${c.entreprise.nom}
Envoyée le : ${c.dateEnvoi}

Mail d'origine :
${c.mail.corps}`,
    }],
  })).corps;
}

function blocRelance(c, cellule) {
  const zone = el("div", { class: "relance" });
  const texte = el("textarea", { rows: "6" });
  const etat = el("span", { class: "infos" });
  const preparer = el("button", {
    type: "button", class: "bouton", texte: "Préparer la relance",
    onclick: async () => {
      preparer.disabled = true;
      etat.textContent = "Rédaction…";
      try {
        texte.value = await redigerRelance(c);
        zone.replaceChildren(texte, el("div", { class: "actions" }, creer, annuler), etat);
        etat.textContent = "";
      } catch (err) {
        etat.textContent = messageErreur(err);
        preparer.disabled = false;
      }
    },
  });
  const creer = el("button", {
    type: "button", class: "bouton principal", texte: "Valider → brouillon",
    onclick: async () => {
      creer.disabled = true;
      etat.textContent = "Création du brouillon…";
      try {
        const objet = /^re\s*:/i.test(c.mail.objet) ? c.mail.objet : `Re: ${c.mail.objet}`;
        const b = await creerBrouillon({ a: c.contact.email, objet, corps: corpsComplet(texte.value), filDiscussion: c.brouillon?.filDiscussion });
        c.relance = { corps: texte.value, brouillon: b, le: new Date().toISOString() };
        sauver();
        afficherSuivi();
      } catch (err) {
        etat.textContent = err.message;
        creer.disabled = false;
      }
    },
  });
  const annuler = el("button", { type: "button", class: "bouton", texte: "Annuler", onclick: () => afficherSuivi() });
  zone.append(preparer, etat);
  cellule.append(zone);
}

function afficherSuivi() {
  const lignes = donnees.candidatures
    .filter((c) => c.statut === "validee")
    .sort((a, b) => (b.valideeLe ?? "").localeCompare(a.valideeLe ?? ""));

  $("suivi-lignes").replaceChildren(...lignes.map((c) => {
    const modifier = (fn) => {
      fn();
      sauver();
      afficherSuivi();
    };
    const dateEnvoi = el("input", { type: "date", value: c.dateEnvoi ?? "", onchange: (ev) => modifier(() => (c.dateEnvoi = ev.target.value || undefined)) });
    const reponse = el("select", { onchange: (ev) => modifier(() => (c.reponse = ev.target.value)) },
      REPONSES.map((r) => el("option", { texte: r, selected: (c.reponse ?? "En attente") === r })));

    const relancePrevue = c.dateEnvoi ? ajouterJours(c.dateEnvoi, JOURS_AVANT_RELANCE) : null;
    const relanceDue = relancePrevue && relancePrevue <= aujourdhui() && (c.reponse ?? "En attente") === "En attente" && !c.relance;
    const celluleRelance = el("td", {});
    if (c.relance) {
      celluleRelance.append(
        c.relance.brouillon ? lien(`Brouillon du ${dateCourte(c.relance.le)}`, lienBrouillon(c.relance.brouillon.messageId)) : `Préparée le ${dateCourte(c.relance.le)}`,
      );
    } else if (relanceDue) {
      blocRelance(c, celluleRelance);
    } else {
      celluleRelance.textContent = relancePrevue ? `Prévue le ${dateCourte(relancePrevue)}` : "Après l'envoi";
    }

    return el("tr", { class: relanceDue ? "a-relancer" : "" },
      el("td", {}, el("strong", { texte: c.entreprise.nom }), el("div", { class: "infos", texte: c.mail.objet })),
      el("td", {}, `${c.contact.prenom} ${c.contact.nom}`.trim(), el("div", { class: "infos", texte: c.contact.email })),
      el("td", {}, dateEnvoi,
        !c.dateEnvoi && el("button", { type: "button", class: "lien-bouton", texte: "Envoyée aujourd'hui", onclick: () => modifier(() => (c.dateEnvoi = aujourdhui())) })),
      celluleRelance,
      el("td", {}, reponse),
      el("td", {}, c.brouillon && lien("Gmail", lienBrouillon(c.brouillon.messageId))),
    );
  }));
  if (!lignes.length) {
    $("suivi-lignes").append(el("tr", {}, el("td", { colspan: "6", class: "vide", texte: "Aucune candidature validée pour l'instant." })));
  }

  const rejetees = donnees.candidatures.filter((c) => c.statut === "rejetee");
  $("rejetees").replaceChildren(...rejetees.map((c) => el("li", {},
    c.entreprise.nom, " ",
    el("button", {
      type: "button", class: "lien-bouton", texte: "Remettre à valider",
      onclick: () => {
        c.statut = "a_valider";
        sauver();
        afficherSuivi();
      },
    }),
  )));
  if (!rejetees.length) $("rejetees").append(el("li", { class: "infos", texte: "Aucune." }));
  compteurs();
}

// ---------- Réglages ----------

function initReglages() {
  const form = $("form-reglages");
  for (const champ of form.elements) if (champ.name) champ.value = donnees.cles[champ.name] ?? "";
  form.addEventListener("input", (ev) => {
    donnees.cles[ev.target.name] = ev.target.value.trim();
    if (ev.target.name === "googleClientId") jetonGmail = null;
    sauver();
  });

  $("bouton-gmail").addEventListener("click", () => connecterGmail().catch((e) => ($("etat-gmail").textContent = e.message)));

  $("bouton-exporter").addEventListener("click", () => {
    const { cles, ...sansCles } = donnees;
    const blob = new Blob([JSON.stringify(sansCles, null, 2)], { type: "application/json" });
    el("a", { href: URL.createObjectURL(blob), download: `candidatures-${aujourdhui()}.json` }).click();
  });

  $("importer").addEventListener("change", async (ev) => {
    const fichier = ev.target.files[0];
    if (!fichier) return;
    try {
      const d = JSON.parse(await fichier.text());
      if (!d.profil || !Array.isArray(d.candidatures)) throw new Error();
      if (!confirm("Remplacer les données actuelles par cette sauvegarde ? Vos clés sont conservées.")) return;
      donnees = { ...VIDE(), ...d, cles: donnees.cles };
      sauver();
      location.reload();
    } catch {
      alerte("Ce fichier n'est pas une sauvegarde valide.");
    }
  });

  $("bouton-effacer").addEventListener("click", () => {
    if (!confirm("Effacer le profil, les entreprises, les candidatures et les clés de ce navigateur ? C'est définitif (vos brouillons Gmail restent).")) return;
    try {
      localStorage.removeItem(CLE_STOCKAGE);
    } catch {
      // rien à effacer
    }
    location.reload();
  });
}

// ---------- Démarrage ----------

initProfil();
initRecherche();
initReglages();
$("form-recherche").addEventListener("submit", () => chercher(true));
$("bouton-plus").addEventListener("click", () => {
  recherche.page++;
  chercher(false);
});
$("bouton-ma-liste").addEventListener("click", chercherMaListe);
$("bouton-tout-preparer").addEventListener("click", toutPreparer);
window.addEventListener("hashchange", onglet);
onglet();
compteurs();
