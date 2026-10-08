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
  verifiee: { libelle: "Vérifiée", classe: "ok", aide: "Vérifiée par Hunter : l'adresse existe." },
  probable: { libelle: "Probable", classe: "moyen", aide: "Adresse nominative trouvée publiée sur le web, mais pas vérifiée." },
  generique: { libelle: "Générique", classe: "info", aide: "Adresse générale de l'entreprise (contact@…) : le mail arrive, mais pas forcément à la bonne personne." },
  supposee: { libelle: "Supposée", classe: "faible", aide: "Adresse devinée à partir du format habituel (prénom.nom@…) : vérifiez-la avant d'envoyer." },
  aucune: { libelle: "À trouver", classe: "faible", aide: "Aucune adresse trouvée : renseignez-la vous-même." },
  saisie: { libelle: "Saisie par vous", classe: "info", aide: "Adresse renseignée par vous." },
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
  e.append(...enfants.flat(2).filter((x) => x !== null && x !== undefined && x !== false && x !== ""));
  return e;
}

function lien(texte, url, attributs = {}) {
  return el("a", { href: url, target: "_blank", rel: "noopener", texte, ...attributs });
}

function alerte(message) {
  const a = $("alerte");
  a.replaceChildren(...[message].flat());
  a.hidden = !message;
}

function toast(message, action) {
  const t = el("div", { class: "toast" }, el("span", { texte: message }));
  const fermer = () => t.remove();
  if (action) {
    t.append(el("button", {
      type: "button",
      class: "lien-bouton",
      texte: action.libelle,
      onclick: () => {
        action.faire();
        fermer();
      },
    }));
  }
  $("toasts").append(t);
  setTimeout(fermer, action ? 8000 : 5000);
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
const pluriel = (n, mot, motPluriel = mot + "s") => `${n} ${n > 1 ? motPluriel : mot}`;

function sansAccents(texte) {
  return (texte ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function puces(conteneur, valeurs, choisies, auChangement) {
  conteneur.replaceChildren(...valeurs.map(([valeur, libelle]) =>
    el("button", {
      type: "button",
      class: "puce",
      texte: libelle,
      "aria-pressed": String(choisies.includes(valeur)),
      "data-valeur": valeur,
      onclick: (ev) => {
        const b = ev.currentTarget;
        b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
        auChangement([...conteneur.querySelectorAll('.puce[aria-pressed="true"]')].map((x) => x.dataset.valeur));
      },
    })
  ));
}

// ---------- Navigation et état général ----------

const ONGLETS = ["profil", "entreprises", "valider", "suivi", "reglages"];

const candidaturesAvecStatut = (statut) => donnees.candidatures.filter((c) => c.statut === statut);

function manquesProfil() {
  const p = donnees.profil;
  const manques = [];
  if (!p.prenom.trim() || !p.nom.trim()) manques.push("prénom et nom");
  if (!p.email.trim()) manques.push("e-mail");
  if (!p.postes.trim()) manques.push("postes visés");
  if (!p.cvMaitre.trim()) manques.push("CV complet");
  return manques;
}

function relanceDue(c) {
  return c.statut === "validee" && c.dateEnvoi && !c.relance && (c.reponse ?? "En attente") === "En attente" &&
    ajouterJours(c.dateEnvoi, JOURS_AVANT_RELANCE) <= aujourdhui();
}

function premierOngletUtile() {
  if (manquesProfil().length || !donnees.cles.anthropic) return "profil";
  if (candidaturesAvecStatut("a_valider").length) return "valider";
  if (donnees.candidatures.some(relanceDue)) return "suivi";
  return "entreprises";
}

function onglet() {
  let nom = location.hash.slice(1);
  if (!ONGLETS.includes(nom)) nom = premierOngletUtile();
  document.querySelectorAll(".onglet").forEach((s) => (s.hidden = s.id !== nom));
  document.querySelectorAll("#etapes a").forEach((a) => {
    if (a.dataset.onglet === nom) a.setAttribute("aria-current", "step");
    else a.removeAttribute("aria-current");
  });
  alerte("");
  if (nom === "entreprises") afficherRetenues();
  if (nom === "valider") afficherFiches();
  if (nom === "suivi") afficherSuivi();
}

function demarrage() {
  const etapes = [
    { fait: !!donnees.cles.anthropic, texte: "Ajouter votre clé Claude", lien: "#reglages", action: "Réglages" },
    { fait: manquesProfil().length === 0, texte: "Remplir votre profil et coller votre CV", lien: "#profil", action: "Profil" },
    {
      fait: Object.values(donnees.entreprises).some((e) => e.statut !== "ecartee") || donnees.candidatures.length > 0,
      texte: "Retenir une première entreprise",
      lien: "#entreprises",
      action: "Entreprises",
    },
    { fait: !!donnees.cles.googleClientId, texte: "Connecter Gmail (facultatif)", lien: "#reglages", action: "Réglages" },
  ];
  $("demarrage").hidden = etapes.slice(0, 3).every((e) => e.fait);
  $("liste-demarrage").replaceChildren(...etapes.map((e) =>
    el("li", { class: e.fait ? "fait" : "" },
      el("span", { class: "coche", "aria-hidden": "true", texte: e.fait ? "✓" : "" }),
      el("span", { class: "texte", texte: e.texte }),
      !e.fait && el("a", { href: e.lien, texte: `${e.action} →` }),
    )
  ));
}

// Met à jour les compteurs des étapes, la liste de démarrage et le titre de l'onglet.
function compteurs() {
  const manques = manquesProfil();
  const retenues = Object.values(donnees.entreprises).filter((e) => e.statut === "retenue").length;
  const aValider = candidaturesAvecStatut("a_valider").length;
  const validees = candidaturesAvecStatut("validee");
  const relances = validees.filter(relanceDue).length;
  const enCours = file.length + (preparationEnCours ? 1 : 0);

  const etat = (id, texte, { fait = false, important = false } = {}) => {
    const span = $(`etat-${id}`);
    span.textContent = texte;
    span.classList.toggle("alerte", important);
    span.parentElement.classList.toggle("fait", fait);
  };
  etat("profil", manques.length ? "À compléter" : "Complet", { fait: !manques.length, important: manques.length > 0 });
  etat("entreprises", enCours ? `${enCours} en préparation` : retenues ? pluriel(retenues, "retenue") : "Chercher");
  etat("valider", aValider ? `${aValider} à relire` : "Rien en attente", { important: aValider > 0 });
  etat("suivi", relances ? pluriel(relances, "relance") : validees.length ? `${validees.length} en cours` : "Rien encore", { important: relances > 0 });

  document.title = (aValider ? `(${aValider}) ` : "") + "Candidatures spontanées · Job Événementiel & Com";
  demarrage();
}

// ---------- Profil ----------

function jaugeProfil() {
  const p = donnees.profil;
  const points = [p.prenom && p.nom, p.email, p.postes, p.cvMaitre.trim(), p.signature.trim()];
  const score = Math.round((points.filter(Boolean).length / points.length) * 100);
  const manques = manquesProfil();
  $("jauge-profil").replaceChildren(
    el("span", { class: "barre", "aria-hidden": "true" }, el("span", { style: `width:${score}%` })),
    el("span", { texte: manques.length ? `Il manque : ${manques.join(", ")}` : score < 100 ? "Profil prêt (la signature est conseillée)" : "Profil complet" }),
  );
}

function initProfil() {
  const form = $("form-profil");
  for (const champ of form.elements) {
    if (champ.name && champ.name in donnees.profil) champ.value = donnees.profil[champ.name];
  }
  form.addEventListener("input", (ev) => {
    if (!ev.target.name) return;
    donnees.profil[ev.target.name] = ev.target.value;
    sauver();
    jaugeProfil();
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
    if (fichier.size > 2_000_000) {
      $("cv-pdf-nom").textContent = "Ce PDF dépasse 2 Mo : le navigateur ne peut pas le garder. Exportez une version plus légère.";
      return;
    }
    donnees.profil.cvPdf = { nom: fichier.name, base64: enBase64(new Uint8Array(await fichier.arrayBuffer())) };
    sauver();
    $("cv-pdf-nom").textContent = `Enregistré : ${fichier.name}`;
  });
  jaugeProfil();
}

// ---------- Entreprises ----------

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
    if (!res.ok) throw new Error(`L'annuaire des entreprises ne répond pas (erreur ${res.status}). Réessayez dans un moment.`);
    return res.json();
  }
  throw new Error("L'annuaire des entreprises est saturé. Réessayez dans une minute.");
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
    if (nouvelle) $("resultats-compteur").scrollIntoView({ behavior: "smooth", block: "start" });
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
    bouton.textContent = `Recherche ${i + 1} sur ${noms.length}…`;
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
  if (introuvables.length) alerte(`Introuvables dans l'annuaire : ${introuvables.join(", ")}. Vérifiez l'orthographe ou essayez le nom officiel.`);
}

function carteEntreprise(e, ...contenu) {
  const dirigeants = e.dirigeants.map((d) => `${d.prenom} ${d.nom}`.trim() + (d.qualite ? ` (${d.qualite})` : "")).join(", ");
  return el("li", { class: "carte" },
    el("div", { class: "entete" },
      el("h3", { texte: e.nom }),
      lien("Fiche officielle ↗", `https://annuaire-entreprises.data.gouv.fr/entreprise/${e.siren}`),
    ),
    el("p", { class: "infos", texte: [e.activite, e.ville, e.effectif].filter(Boolean).join(" · ") }),
    dirigeants && el("p", { class: "infos petit", texte: `Dirigeants : ${dirigeants}` }),
    contenu,
  );
}

function decider(entreprise, statut) {
  const avant = donnees.entreprises[entreprise.siren];
  donnees.entreprises[entreprise.siren] = { ...entreprise, ...avant, statut };
  sauver();
  afficherResultats();
  afficherRetenues();
  const annuler = {
    libelle: "Annuler",
    faire: () => {
      if (avant) donnees.entreprises[entreprise.siren] = avant;
      else delete donnees.entreprises[entreprise.siren];
      sauver();
      afficherResultats();
      afficherRetenues();
    },
  };
  toast(statut === "retenue" ? `${entreprise.nom} retenue` : `${entreprise.nom} passée`, annuler);
}

function afficherResultats() {
  const aTrier = recherche.resultats.filter((e) => !donnees.entreprises[e.siren]);
  const dejaVues = recherche.resultats.length - aTrier.length;
  $("resultats-compteur").textContent = recherche.total === undefined ? "" :
    `${pluriel(recherche.total, "entreprise trouvée", "entreprises trouvées")}` +
    (dejaVues ? ` · ${pluriel(dejaVues, "déjà triée masquée", "déjà triées masquées")}` : "");
  $("resultats").replaceChildren(...aTrier.map((e) => carteEntreprise(e,
    el("div", { class: "actions" },
      el("button", { type: "button", class: "bouton principal", texte: "Retenir", onclick: () => decider(e, "retenue") }),
      el("button", { type: "button", class: "bouton", texte: "Passer", onclick: () => decider(e, "ecartee") }),
    ),
  )));
  if (recherche.total !== undefined && !aTrier.length) {
    $("resultats").append(el("li", { class: "vide" },
      el("p", { texte: recherche.resultats.length ? "Toutes ces entreprises sont déjà triées." : "Aucune entreprise ne correspond. Élargissez les secteurs, les départements ou la taille." }),
    ));
  }
  $("bouton-plus").hidden = !(recherche.pages > recherche.page);
}

// ---------- File de préparation ----------

const ETAPES_PREPARATION = [
  "Recherche de l'entreprise, du contact et de l'actualité",
  "Rédaction du mail et du CV",
  "Recherche de l'adresse e-mail",
];
const file = []; // sirens en attente
let preparationEnCours = null; // { siren, etape }

function listeEtapes(etapeCourante) {
  return el("ol", { class: "etapes-prep" },
    ETAPES_PREPARATION.map((texte, i) =>
      el("li", { class: i < etapeCourante ? "fait" : i === etapeCourante ? "encours" : "", texte })),
  );
}

function prerequisPreparation() {
  if (!donnees.cles.anthropic) {
    alerte(["Ajoutez d'abord votre clé Claude. ", el("a", { href: "#reglages", texte: "Aller aux réglages →" })]);
    return false;
  }
  if (!donnees.profil.cvMaitre.trim()) {
    alerte(["Collez d'abord votre CV complet dans le profil. ", el("a", { href: "#profil", texte: "Aller au profil →" })]);
    return false;
  }
  return true;
}

function ajouterALaFile(sirens) {
  if (!prerequisPreparation()) return;
  for (const siren of sirens) {
    if (!file.includes(siren) && preparationEnCours?.siren !== siren) {
      delete donnees.entreprises[siren].erreur;
      file.push(siren);
    }
  }
  afficherRetenues();
  compteurs();
  traiterFile();
}

async function traiterFile() {
  if (preparationEnCours) return;
  while (file.length) {
    const siren = file.shift();
    const e = donnees.entreprises[siren];
    preparationEnCours = { siren, etape: 0 };
    afficherRetenues();
    try {
      await preparer(siren, {
        surEtape: (etape) => {
          preparationEnCours.etape = etape;
          afficherRetenues();
        },
      });
      e.statut = "preparee";
      sauver();
      toast(`Candidature prête : ${e.nom}`, { libelle: "Relire", faire: () => (location.hash = "#valider") });
    } catch (err) {
      e.erreur = messageErreur(err);
      sauver();
      if (erreurBloquante(err)) {
        file.length = 0;
        alerte(e.erreur);
      }
    }
    preparationEnCours = null;
  }
  afficherRetenues();
  compteurs();
  if (!$("valider").hidden) afficherFiches();
}

function afficherRetenues() {
  const retenues = Object.values(donnees.entreprises).filter((e) => e.statut === "retenue");
  $("zone-retenues").hidden = retenues.length === 0;
  $("nb-retenues").textContent = retenues.length ? `(${retenues.length})` : "";
  const aPreparer = retenues.filter((e) => !file.includes(e.siren) && preparationEnCours?.siren !== e.siren);
  $("bouton-tout-preparer").hidden = aPreparer.length === 0;
  $("bouton-tout-preparer").textContent = aPreparer.length > 1 ? `Préparer les ${aPreparer.length} candidatures` : "Préparer la candidature";

  $("retenues").replaceChildren(...retenues.map((e) => {
    let contenu;
    if (preparationEnCours?.siren === e.siren) {
      contenu = listeEtapes(preparationEnCours.etape);
    } else if (file.includes(e.siren)) {
      contenu = el("div", { class: "actions" },
        el("span", { class: "infos", texte: `En attente (${file.indexOf(e.siren) + 1}ᵉ dans la file)` }),
        el("button", {
          type: "button", class: "lien-bouton", texte: "Retirer de la file",
          onclick: () => {
            file.splice(file.indexOf(e.siren), 1);
            afficherRetenues();
            compteurs();
          },
        }),
      );
    } else {
      contenu = [
        e.erreur && el("p", { class: "erreur", texte: e.erreur }),
        el("div", { class: "actions" },
          el("button", { type: "button", class: "bouton principal", texte: e.erreur ? "Réessayer" : "Préparer", onclick: () => ajouterALaFile([e.siren]) }),
          el("button", { type: "button", class: "bouton", texte: "Retirer", onclick: () => decider(e, "ecartee") }),
        ),
      ];
    }
    return carteEntreprise(e, contenu);
  }));
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

// Erreurs qui feraient échouer toutes les préparations suivantes : on arrête la file.
function erreurBloquante(e) {
  return e instanceof Anthropic.AuthenticationError || /credit balance/i.test(e?.message ?? "");
}

function messageErreur(e) {
  if (/credit balance/i.test(e?.message ?? "")) {
    return "Plus de crédit sur votre compte Claude : ajoutez-en sur console.anthropic.com (Settings → Billing), puis cliquez sur Réessayer.";
  }
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

async function rediger(e, notes, consigne = "") {
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
</cv_maitre>${consigne ? `

Consigne de la personne pour cette version : ${consigne}` : ""}`,
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

// ---------- Relance ----------

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

// ---------- Préparation ----------

// Prépare (ou régénère) la candidature d'une entreprise retenue.
// Sans `refaireRecherche`, une régénération réutilise les notes de recherche et le contact.
async function preparer(siren, { consigne = "", refaireRecherche = true, surEtape = () => {} } = {}) {
  const e = donnees.entreprises[siren];
  const ancienne = donnees.candidatures.find((c) => c.siren === siren && c.statut === "a_valider");
  const nouvelleRecherche = refaireRecherche || !ancienne?.notes;

  surEtape(0);
  const notes = nouvelleRecherche ? await rechercherEntreprise(e) : ancienne.notes;
  surEtape(1);
  const r = await rediger(e, notes, consigne);
  surEtape(2);
  const contact = nouvelleRecherche
    ? { prenom: r.contact.prenom, nom: r.contact.nom, poste: r.contact.poste, source: r.contact.source, pourquoi: r.contact.pourquoi, ...(await trouverAdresse(r)) }
    : ancienne.contact;

  const candidature = {
    id: ancienne?.id ?? crypto.randomUUID(),
    siren,
    entreprise: { nom: e.nom, activite: e.activite, ville: e.ville, site: r.site || ancienne?.entreprise.site || "" },
    notes,
    contact,
    verifiee: nouvelleRecherche ? false : ancienne.verifiee,
    angle: r.angle,
    mail: r.mail,
    cv: { ...r.cv, experiences: r.cv.experiences.map((x) => ({ ...x, garder: true })) },
    pieceJointe: ancienne?.pieceJointe ?? "adapte",
    precedente: ancienne ? { angle: ancienne.angle, mail: ancienne.mail, cv: ancienne.cv, contact: ancienne.contact } : null,
    statut: "a_valider",
    prepareLe: ancienne?.prepareLe ?? new Date().toISOString(),
  };
  donnees.candidatures = donnees.candidatures.filter((c) => c.id !== candidature.id);
  donnees.candidatures.push(candidature);
  sauver();
  return candidature;
}

// ---------- À valider : une candidature à la fois ----------

let positionFiche = 0;
let ficheEnEdition = null; // id de la candidature dont le mail est en mode modification

const ADRESSE_A_VERIFIER = ["supposee", "aucune"];

function champ(libelle, valeur, auChangement, { multi = false, rows = 8, type = "text", id } = {}) {
  const saisie = multi
    ? el("textarea", { id, rows: String(rows), oninput: (ev) => auChangement(ev.target.value) })
    : el("input", { id, type, oninput: (ev) => auChangement(ev.target.value) });
  saisie.value = valeur ?? "";
  return el("label", {}, libelle, saisie);
}

function badgeFiabilite(contact) {
  const f = FIABILITE[contact.fiabilite] ?? FIABILITE.aucune;
  return el("span", { class: `fiabilite ${f.classe}`, texte: f.libelle });
}

function blocContact(c, rafraichir) {
  const ct = c.contact;
  const modifier = (fn) => {
    fn();
    sauver();
  };
  const f = FIABILITE[ct.fiabilite] ?? FIABILITE.aucune;
  const email = el("input", {
    id: `email-${c.id}`,
    type: "email",
    oninput: (ev) => modifier(() => (ct.email = ev.target.value.trim())),
    onchange: () => modifier(() => {
      ct.fiabilite = ct.email ? "saisie" : "aucune";
      ct.detail = "";
      rafraichir();
    }),
  });
  email.value = ct.email;

  return el("section", { "aria-labelledby": `contact-${c.id}` },
    el("h4", { class: "etiquette-section", id: `contact-${c.id}`, texte: "Contact" }),
    el("div", { class: "deux" },
      champ("Prénom", ct.prenom, (v) => modifier(() => (ct.prenom = v))),
      champ("Nom", ct.nom, (v) => modifier(() => (ct.nom = v))),
      champ("Poste", ct.poste, (v) => modifier(() => (ct.poste = v))),
      el("label", { for: `email-${c.id}` }, el("span", {}, "E-mail ", badgeFiabilite(ct)), email),
    ),
    el("p", { class: "explication" }, f.aide, ct.detail ? ` (${ct.detail})` : ""),
    (ct.pourquoi || ct.source) && el("p", { class: "explication" },
      ct.pourquoi,
      ct.source?.startsWith("http") ? [" ", lien("Voir la source ↗", ct.source)] : ct.source ? ` Source : ${ct.source}.` : "",
    ),
    ct.generique && el("p", { class: "explication", texte: `Adresse générale de repli : ${ct.generique}` }),
    ADRESSE_A_VERIFIER.includes(ct.fiabilite) && el("div", { class: "verif" + (c.verifiee ? " ok" : "") },
      el("label", { class: "case" },
        el("input", {
          type: "checkbox",
          checked: !!c.verifiee,
          onchange: (ev) => modifier(() => {
            c.verifiee = ev.target.checked;
            rafraichir();
          }),
        }),
        "J'ai vérifié cette adresse (site de l'entreprise, LinkedIn, appel…)",
      ),
    ),
  );
}

function blocAngle(c) {
  return el("section", {},
    el("h4", { class: "etiquette-section", texte: "Accroche" }),
    el("p", { texte: c.angle.accroche }),
    c.angle.sources.length > 0 && el("ol", { class: "sources" },
      c.angle.sources.map((s) => el("li", {}, lien(`${s.titre || s.url} ↗`, s.url), s.date ? ` (${s.date})` : "")),
    ),
  );
}

function nomPieceJointe(c) {
  return c.pieceJointe === "origine" && donnees.profil.cvPdf ? donnees.profil.cvPdf.nom : nomFichierCv();
}

function blocMail(c, rafraichir) {
  const enEdition = ficheEnEdition === c.id;
  const basculer = el("button", {
    type: "button",
    class: "bouton",
    texte: enEdition ? "Terminer" : "Modifier le mail",
    onclick: () => {
      ficheEnEdition = enEdition ? null : c.id;
      rafraichir();
    },
  });
  const contenu = enEdition
    ? [
      champ("Objet", c.mail.objet, (v) => {
        c.mail.objet = v;
        sauver();
      }, { id: `objet-${c.id}` }),
      champ("Message (votre signature est ajoutée à la fin)", c.mail.corps, (v) => {
        c.mail.corps = v;
        sauver();
      }, { multi: true, rows: 14, id: `corps-${c.id}` }),
    ]
    : el("div", { class: "apercu-mail" },
      el("dl", {},
        el("dt", { texte: "À" }), el("dd", { texte: c.contact.email || "adresse à renseigner" }),
        el("dt", { texte: "Objet" }), el("dd", {}, el("strong", { texte: c.mail.objet })),
      ),
      el("div", { class: "corps", texte: corpsComplet(c.mail.corps) }),
      el("span", { class: "tag pj", texte: `📎 ${nomPieceJointe(c)}` }),
    );
  return el("section", {},
    el("div", { class: "actions", style: "justify-content: space-between" },
      el("h4", { class: "etiquette-section", texte: "Mail" }),
      basculer,
    ),
    contenu,
  );
}

function blocRegenerer(c, rafraichir) {
  const consignes = ["Plus court", "Plus formel", "Plus chaleureux", "Autre accroche"];
  const choix = el("div", { class: "puces" },
    consignes.map((t) => el("button", {
      type: "button",
      class: "puce",
      "aria-pressed": "false",
      texte: t,
      onclick: (ev) => ev.currentTarget.setAttribute("aria-pressed", String(ev.currentTarget.getAttribute("aria-pressed") !== "true")),
    })),
  );
  const libre = el("textarea", { rows: "2", id: `consigne-${c.id}`, placeholder: "Ex. parler de mon expérience au festival X, ne pas mentionner le stage" });
  const recherche = el("input", { type: "checkbox" });
  const etat = el("div", { class: "infos" });
  const bouton = el("button", {
    type: "button",
    class: "bouton principal",
    texte: "Régénérer",
    onclick: async () => {
      if (!prerequisPreparation()) return;
      const consigne = [
        ...[...choix.querySelectorAll('[aria-pressed="true"]')].map((b) => b.textContent),
        libre.value.trim(),
      ].filter(Boolean).join(". ");
      bouton.disabled = true;
      try {
        await preparer(c.siren, {
          consigne,
          refaireRecherche: recherche.checked,
          surEtape: (i) => etat.replaceChildren(listeEtapes(recherche.checked ? i : Math.max(i, 1))),
        });
        ficheEnEdition = null;
        toast("Nouvelle version prête");
        rafraichir();
      } catch (err) {
        etat.replaceChildren(el("p", { class: "erreur", texte: messageErreur(err) }));
        bouton.disabled = false;
      }
    },
  });

  return el("details", { class: "repli" },
    el("summary", { texte: "Régénérer avec une consigne…" }),
    el("div", { class: "contenu" },
      choix,
      el("label", { for: `consigne-${c.id}` }, "Autre consigne (facultatif)", libre),
      el("label", { class: "case" }, recherche, "Refaire aussi la recherche (autre contact, autre actualité)"),
      el("div", { class: "actions" },
        bouton,
        c.precedente && el("button", {
          type: "button",
          class: "bouton",
          texte: "Revenir à la version précédente",
          onclick: () => {
            const { angle, mail, cv, contact } = c.precedente;
            c.precedente = { angle: c.angle, mail: c.mail, cv: c.cv, contact: c.contact };
            Object.assign(c, { angle, mail, cv, contact });
            sauver();
            toast("Version précédente rétablie");
            rafraichir();
          },
        }),
      ),
      etat,
    ),
  );
}

function blocCv(c) {
  const cv = c.cv;
  const modifier = (fn) => {
    fn();
    sauver();
  };
  const details = el("div", { class: "contenu" });
  const champsCv = el("div", { class: "contenu", hidden: c.pieceJointe === "origine" },
    champ("Titre du CV", cv.titre, (v) => modifier(() => (cv.titre = v))),
    champ("Accroche", cv.accroche, (v) => modifier(() => (cv.accroche = v)), { multi: true, rows: 3 }),
    el("p", { class: "infos", texte: "Expériences mises en avant. Décochez pour en retirer une ; une mission par ligne." }),
    cv.experiences.map((x, i) => {
      const id = `exp-${c.id}-${i}`;
      const points = el("textarea", {
        id,
        rows: String(Math.max(3, x.points.length + 1)),
        oninput: (ev) => modifier(() => (x.points = ev.target.value.split("\n").filter((l) => l.trim()))),
      });
      points.value = x.points.join("\n");
      return el("div", { class: "experience" },
        el("label", { class: "case" },
          el("input", { type: "checkbox", checked: x.garder, onchange: (ev) => modifier(() => (x.garder = ev.target.checked)) }),
          el("span", {}, el("strong", { texte: `${x.poste} · ${x.structure}` }), " ", el("span", { class: "infos", texte: x.dates })),
        ),
        el("label", { for: id, class: "infos" }, "Missions", points),
      );
    }),
    champ("Compétences (séparées par des virgules)", cv.competences.join(", "), (v) => modifier(() => (cv.competences = v.split(",").map((s) => s.trim()).filter(Boolean)))),
  );

  const resume = el("span", { texte: `CV joint : ${c.pieceJointe === "origine" ? "mon CV d'origine" : "CV adapté"}` });
  const choix = el("div", { class: "puces" },
    [["adapte", "CV adapté à l'entreprise"], ["origine", "Mon CV PDF d'origine"]].map(([valeur, libelle]) =>
      el("button", {
        type: "button",
        class: "puce",
        "aria-pressed": String(c.pieceJointe === valeur),
        texte: libelle,
        disabled: valeur === "origine" && !donnees.profil.cvPdf,
        title: valeur === "origine" && !donnees.profil.cvPdf ? "Ajoutez votre CV PDF dans le profil" : undefined,
        onclick: (ev) => {
          modifier(() => (c.pieceJointe = valeur));
          choix.querySelectorAll(".puce").forEach((b) => b.setAttribute("aria-pressed", String(b === ev.currentTarget)));
          champsCv.hidden = valeur === "origine";
          resume.textContent = `CV joint : ${valeur === "origine" ? "mon CV d'origine" : "CV adapté"}`;
        },
      })
    ),
  );
  details.append(
    choix,
    champsCv,
    el("div", { class: "actions" }, el("button", { type: "button", class: "bouton", texte: "Voir le CV (PDF)", onclick: () => apercuCv(c) })),
  );
  return el("details", { class: "repli" }, el("summary", {}, resume), details);
}

function ficheValidation(c, rafraichir) {
  const ct = c.contact;
  const etat = el("p", { class: "infos", "aria-live": "polite" });
  const aVerifier = ADRESSE_A_VERIFIER.includes(ct.fiabilite) && !c.verifiee;
  const blocage = !ct.email ? "Renseignez l'adresse e-mail du contact." : aVerifier ? "Cochez « J'ai vérifié cette adresse » pour continuer." : "";

  const creer = el("button", {
    type: "button",
    class: "bouton principal",
    texte: "Créer le brouillon Gmail",
    disabled: !!blocage,
    title: blocage || undefined,
    onclick: async () => {
      creer.disabled = true;
      etat.textContent = "Création du brouillon…";
      try {
        const b = await creerBrouillon({ a: ct.email, objet: c.mail.objet, corps: corpsComplet(c.mail.corps), pj: pieceJointe(c) });
        Object.assign(c, { statut: "validee", brouillon: b, valideeLe: new Date().toISOString(), reponse: "En attente" });
        sauver();
        toast(`Brouillon créé dans Gmail pour ${c.entreprise.nom}`, { libelle: "Ouvrir", faire: () => window.open(lienBrouillon(b.messageId), "_blank", "noopener") });
        rafraichir();
      } catch (err) {
        etat.textContent = err.message;
        creer.disabled = false;
      }
    },
  });

  const sansGmail = el("button", {
    type: "button",
    class: "lien-bouton",
    texte: "Pas de Gmail ? Télécharger le CV et ouvrir le mail",
    disabled: !!blocage,
    title: "Télécharge le CV et ouvre le mail dans votre messagerie habituelle",
    onclick: () => {
      const pj = pieceJointe(c);
      el("a", { href: `data:application/pdf;base64,${pj.base64}`, download: pj.nom }).click();
      location.href = `mailto:${encodeURIComponent(ct.email)}?subject=${encodeURIComponent(c.mail.objet)}&body=${encodeURIComponent(corpsComplet(c.mail.corps))}`;
      Object.assign(c, { statut: "validee", valideeLe: new Date().toISOString(), reponse: "En attente" });
      sauver();
      toast("CV téléchargé. Joignez-le au mail avant d'envoyer.");
      rafraichir();
    },
  });

  const ecarter = el("button", {
    type: "button",
    class: "bouton discret danger",
    texte: "Écarter",
    onclick: () => {
      c.statut = "rejetee";
      sauver();
      rafraichir();
      toast(`Candidature ${c.entreprise.nom} écartée`, {
        libelle: "Annuler",
        faire: () => {
          c.statut = "a_valider";
          sauver();
          rafraichir();
        },
      });
    },
  });

  return el("article", { class: "bloc fiche", "aria-labelledby": `titre-${c.id}` },
    el("header", {},
      el("div", { class: "entete actions", style: "justify-content: space-between" },
        el("h3", { id: `titre-${c.id}`, texte: c.entreprise.nom }),
        c.entreprise.site && lien("Site ↗", c.entreprise.site),
      ),
      el("p", { class: "infos", texte: [c.entreprise.activite, c.entreprise.ville].filter(Boolean).join(" · ") }),
      el("p", { class: "ia", texte: "Proposé par l'IA à partir de recherches sur le web : relisez avant d'envoyer." }),
    ),
    blocContact(c, rafraichir),
    blocAngle(c),
    blocMail(c, rafraichir),
    blocRegenerer(c, rafraichir),
    blocCv(c),
    el("div", { class: "barre-actions" },
      el("div", { class: "ligne" }, ecarter, creer),
      blocage && el("p", { class: "infos petit", texte: blocage }),
      etat,
    ),
    el("div", { class: "actions" }, sansGmail),
  );
}

function afficherFiches() {
  const liste = candidaturesAvecStatut("a_valider").sort((a, b) => a.prepareLe.localeCompare(b.prepareLe));
  const zone = $("file-valider");
  compteurs();

  if (!liste.length) {
    const enCours = file.length + (preparationEnCours ? 1 : 0);
    zone.replaceChildren(el("div", { class: "vide" },
      el("p", { texte: enCours ? `${pluriel(enCours, "candidature")} en préparation. Elles apparaîtront ici dès qu'elles seront prêtes.` : "Rien à relire pour l'instant." }),
      el("div", { class: "actions" }, el("a", { class: "bouton principal", href: "#entreprises", texte: enCours ? "Suivre la préparation" : "Choisir des entreprises" })),
    ));
    return;
  }

  positionFiche = Math.min(Math.max(positionFiche, 0), liste.length - 1);
  const c = liste[positionFiche];
  const rafraichir = () => afficherFiches();
  const aller = (delta) => {
    positionFiche += delta;
    ficheEnEdition = null;
    afficherFiches();
    $("titre-valider").scrollIntoView({ behavior: "smooth", block: "start" });
  };

  zone.replaceChildren(...[
    liste.length > 1 && el("div", { class: "file-nav" },
      el("button", { type: "button", class: "bouton", texte: "‹ Précédente", disabled: positionFiche === 0, onclick: () => aller(-1) }),
      el("span", { class: "position", texte: `${positionFiche + 1} sur ${liste.length}` }),
      el("button", { type: "button", class: "bouton", texte: "Suivante ›", disabled: positionFiche === liste.length - 1, onclick: () => aller(1) }),
    ),
    ficheValidation(c, rafraichir),
  ].filter(Boolean));
}

// ---------- Suivi ----------

function situation(c) {
  const reponse = c.reponse ?? "En attente";
  if (reponse === "Positive") return { texte: "Réponse positive", classe: "positive", ordre: 3 };
  if (reponse === "Négative") return { texte: "Réponse négative", classe: "negative", ordre: 4 };
  if (reponse === "Pas de réponse") return { texte: "Sans réponse", classe: "", ordre: 4 };
  if (!c.dateEnvoi) return { texte: c.brouillon ? "Brouillon à envoyer" : "À envoyer", classe: "a-faire", ordre: 1 };
  if (relanceDue(c)) return { texte: "Relance à préparer", classe: "a-faire", ordre: 0 };
  if (c.relance) return { texte: `Relancée le ${dateCourte(c.relance.le)}`, classe: "", ordre: 2 };
  return { texte: `Relance le ${dateCourte(ajouterJours(c.dateEnvoi, JOURS_AVANT_RELANCE))}`, classe: "", ordre: 2 };
}

function blocRelance(c) {
  const zone = el("div", { class: "relance" });
  const texte = el("textarea", { rows: "6", "aria-label": `Relance pour ${c.entreprise.nom}` });
  const etat = el("span", { class: "infos" });
  const creer = el("button", {
    type: "button", class: "bouton principal", texte: "Créer le brouillon de relance",
    onclick: async () => {
      creer.disabled = true;
      etat.textContent = "Création du brouillon…";
      try {
        const objet = /^re\s*:/i.test(c.mail.objet) ? c.mail.objet : `Re: ${c.mail.objet}`;
        const b = await creerBrouillon({ a: c.contact.email, objet, corps: corpsComplet(texte.value), filDiscussion: c.brouillon?.filDiscussion });
        c.relance = { corps: texte.value, brouillon: b, le: new Date().toISOString() };
        sauver();
        toast("Brouillon de relance créé dans Gmail", { libelle: "Ouvrir", faire: () => window.open(lienBrouillon(b.messageId), "_blank", "noopener") });
        afficherSuivi();
      } catch (err) {
        etat.textContent = err.message;
        creer.disabled = false;
      }
    },
  });
  const preparerRelance = el("button", {
    type: "button", class: "bouton principal", texte: "Préparer la relance",
    onclick: async () => {
      if (!prerequisPreparation()) return;
      preparerRelance.disabled = true;
      etat.textContent = "Rédaction…";
      try {
        texte.value = await redigerRelance(c);
        etat.textContent = "";
        zone.replaceChildren(texte, el("div", { class: "actions" }, creer, el("button", { type: "button", class: "bouton", texte: "Annuler", onclick: () => afficherSuivi() })), etat);
      } catch (err) {
        etat.textContent = messageErreur(err);
        preparerRelance.disabled = false;
      }
    },
  });
  zone.append(el("div", { class: "actions" }, preparerRelance, etat));
  return zone;
}

function afficherSuivi() {
  const lignes = candidaturesAvecStatut("validee")
    .map((c) => ({ c, s: situation(c) }))
    .sort((a, b) => a.s.ordre - b.s.ordre || (b.c.valideeLe ?? "").localeCompare(a.c.valideeLe ?? ""));

  const compte = (filtre) => lignes.filter(filtre).length;
  const resume = [
    [compte(({ s }) => s.ordre === 0), "relance à préparer", "relances à préparer", "a-faire"],
    [compte(({ s }) => s.ordre === 1), "à envoyer depuis Gmail", "à envoyer depuis Gmail", "a-faire"],
    [compte(({ s }) => s.ordre === 2), "en attente de réponse", "en attente de réponse", ""],
    [compte(({ c }) => c.reponse === "Positive"), "réponse positive", "réponses positives", "positive"],
  ].filter(([n]) => n > 0);
  $("resume-suivi").replaceChildren(...resume.map(([n, un, plusieurs, classe]) =>
    el("span", { class: `statut ${classe}`, texte: pluriel(n, un, plusieurs) })));

  $("suivi-lignes").replaceChildren(...lignes.map(({ c, s }) => {
    const modifier = (fn) => {
      fn();
      sauver();
      afficherSuivi();
    };
    const idDate = `envoi-${c.id}`;
    const idReponse = `reponse-${c.id}`;
    const dateEnvoi = el("input", { id: idDate, type: "date", value: c.dateEnvoi ?? "", onchange: (ev) => modifier(() => (c.dateEnvoi = ev.target.value || undefined)) });
    const reponse = el("select", { id: idReponse, onchange: (ev) => modifier(() => (c.reponse = ev.target.value)) },
      REPONSES.map((r) => el("option", { texte: r, selected: (c.reponse ?? "En attente") === r })));

    return el("li", { class: "carte ligne-suivi" },
      el("div", {}, el("h3", { texte: c.entreprise.nom }), el("p", { class: "infos petit", texte: c.mail.objet })),
      el("div", { class: "contact" },
        el("p", { texte: `${c.contact.prenom} ${c.contact.nom}`.trim() }),
        el("p", { class: "infos petit", texte: c.contact.email }),
      ),
      el("span", { class: `statut ${s.classe}`, texte: s.texte }),
      el("div", { class: "champs" },
        el("label", { for: idDate }, "Envoyée le", dateEnvoi),
        el("label", { for: idReponse }, "Réponse", reponse),
      ),
      el("div", { class: "actions", style: "grid-column: 1 / -1" },
        !c.dateEnvoi && el("button", { type: "button", class: "bouton", texte: "Envoyée aujourd'hui", onclick: () => modifier(() => (c.dateEnvoi = aujourdhui())) }),
        c.brouillon && lien("Mail dans Gmail ↗", lienBrouillon(c.brouillon.messageId)),
        c.relance?.brouillon && lien("Relance dans Gmail ↗", lienBrouillon(c.relance.brouillon.messageId)),
      ),
      relanceDue(c) && blocRelance(c),
    );
  }));
  if (!lignes.length) {
    $("suivi-lignes").append(el("li", { class: "vide" },
      el("p", { texte: "Aucune candidature envoyée pour l'instant. Elles apparaissent ici dès que vous créez un brouillon." }),
      el("div", { class: "actions" }, el("a", { class: "bouton principal", href: "#valider", texte: "Relire les candidatures" })),
    ));
  }

  const rejetees = candidaturesAvecStatut("rejetee");
  $("nb-rejetees").textContent = rejetees.length ? `(${rejetees.length})` : "";
  $("rejetees").replaceChildren(...rejetees.map((c) => el("li", {},
    c.entreprise.nom, " ",
    el("button", {
      type: "button", class: "lien-bouton", texte: "Remettre à relire",
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
$("bouton-tout-preparer").addEventListener("click", () => {
  const sirens = Object.values(donnees.entreprises).filter((e) => e.statut === "retenue").map((e) => e.siren);
  ajouterALaFile(sirens);
});
window.addEventListener("hashchange", onglet);
window.addEventListener("beforeunload", (ev) => {
  if (preparationEnCours || file.length) ev.preventDefault();
});
onglet();
compteurs();
