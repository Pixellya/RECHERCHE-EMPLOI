// Affiche les offres de data/offres.json, de la plus récente à la plus ancienne,
// avec des filtres (recherche, lieu, catégorie, contrat, secteur public), et retient
// dans le navigateur les offres déjà ouvertes, les favoris et la dernière visite.

// Sites d'emploi vers lesquels on renvoie avec une recherche toute prête.
// {q} est remplacé par le mot-clé (« événementiel » ou « communication »).
const SITES = [
  { nom: "Indeed", url: "https://fr.indeed.com/jobs?q={q}&l=%C3%8Ele-de-France&sort=date" },
  { nom: "LinkedIn", url: "https://www.linkedin.com/jobs/search/?keywords={q}&location=%C3%8Ele-de-France&sortBy=DD" },
  { nom: "Welcome to the Jungle", url: "https://www.welcometothejungle.com/fr/jobs?query={q}&aroundQuery=%C3%8Ele-de-France" },
  { nom: "HelloWork", url: "https://www.hellowork.com/fr-fr/emploi/recherche.html?k={q}&l=%C3%8Ele-de-France" },
  { nom: "Apec", url: "https://www.apec.fr/candidat/recherche-emploi.html/emploi?motsCles={q}" },
  { nom: "Meteojob", url: "https://www.meteojob.com/jobs?what={q}&where=%C3%8Ele-de-France" },
  { nom: "Google (offres d'emploi)", url: "https://www.google.com/search?q={q}+emploi+%C3%8Ele-de-France&ibp=htl;jobs" },
  { nom: "France Travail", url: "https://candidat.francetravail.fr/offres/recherche?motsCles={q}&lieux=11R&typeContrat=CDI,CDD&tri=1" },
  { nom: "Profilculture", url: "https://www.profilculture.com/annonce/recherche.aspx?mots={q}" },
  { nom: "Emploi Territorial (mairies, départements)", url: "https://www.emploi-territorial.fr/emploi-mobilite/?search-word={q}" },
  { nom: "Choisir le service public", url: "https://choisirleservicepublic.gouv.fr/nos-offres/filtres/mot-cles/{q}/" },
];

const CLE_MEMOIRE = "offres-memoire-v1";
const PAUSE_ENTRE_VISITES = 30 * 60 * 1000; // au-delà, une nouvelle visite commence

const etat = { offres: [], categorie: "", contrat: "", vue: "" };

const $ = (id) => document.getElementById(id);

// ---------- Mémoire du navigateur ----------

function lireMemoire() {
  try {
    return { vues: [], favoris: [], ...JSON.parse(localStorage.getItem(CLE_MEMOIRE) ?? "{}") };
  } catch {
    return { vues: [], favoris: [] };
  }
}

const memoire = lireMemoire();
const vues = new Set(memoire.vues);
const favoris = new Set(memoire.favoris);

function ecrireMemoire() {
  try {
    localStorage.setItem(CLE_MEMOIRE, JSON.stringify({
      ...memoire,
      vues: [...vues].slice(-500),
      favoris: [...favoris],
    }));
  } catch {
    // Navigation privée ou stockage bloqué : le site fonctionne sans mémoire.
  }
}

// La visite précédente sert de repère pour les offres « nouvelles ».
function repereNouveautes() {
  const maintenant = Date.now();
  if (!memoire.visiteCourante) {
    memoire.visiteCourante = maintenant;
    memoire.visitePrecedente = null;
  } else if (maintenant - memoire.visiteCourante > PAUSE_ENTRE_VISITES) {
    memoire.visitePrecedente = memoire.visiteCourante;
    memoire.visiteCourante = maintenant;
  } else {
    memoire.visiteCourante = maintenant;
  }
  ecrireMemoire();
  return memoire.visitePrecedente;
}

const visitePrecedente = repereNouveautes();
const estNouvelle = (o) => visitePrecedente !== null && new Date(o.date).getTime() > visitePrecedente;

// ---------- Outils ----------

function ilYa(date) {
  const jours = Math.floor((Date.now() - new Date(date)) / 86400000);
  if (jours <= 0) return "Aujourd'hui";
  if (jours === 1) return "Hier";
  return `Il y a ${jours} jours`;
}

function depuis(date) {
  const minutes = Math.round((Date.now() - new Date(date)) / 60000);
  if (minutes < 60) return `il y a ${Math.max(1, minutes)} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  return `le ${new Date(date).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
}

function normaliser(texte) {
  return (texte ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function element(balise, classe, texte) {
  const el = document.createElement(balise);
  if (classe) el.className = classe;
  if (texte) el.textContent = texte;
  return el;
}

function pluriel(n, mot) {
  return `${n} ${mot}${n > 1 ? "s" : ""}`;
}

// ---------- Cartes ----------

function carte(o) {
  const li = element("li", "offre" + (o.categorie === "Communication" ? " communication" : "") + (vues.has(o.id) ? " vue" : ""));

  const haut = element("div", "haut");
  if (estNouvelle(o) && !vues.has(o.id)) haut.append(element("span", "scotch", "Nouveau"));
  haut.append(element("span", "age", ilYa(o.date)));
  if (vues.has(o.id)) haut.append(element("span", "vu", "· Déjà ouverte"));

  const titre = element("h2");
  const a = element("a", null, o.titre);
  a.href = o.url;
  a.target = "_blank";
  a.rel = "noopener";
  a.addEventListener("click", () => {
    vues.add(o.id);
    ecrireMemoire();
    setTimeout(afficher, 300);
  });
  titre.append(a);

  const etoile = element("button", "etoile", favoris.has(o.id) ? "★" : "☆");
  etoile.type = "button";
  etoile.setAttribute("aria-pressed", String(favoris.has(o.id)));
  etoile.setAttribute("aria-label", `${favoris.has(o.id) ? "Retirer des" : "Ajouter aux"} favoris : ${o.titre}`);
  etoile.addEventListener("click", () => {
    if (favoris.has(o.id)) favoris.delete(o.id);
    else favoris.add(o.id);
    ecrireMemoire();
    afficher();
  });

  const tags = element("div", "tags");
  tags.append(element("span", "categorie", o.categorie));
  if (o.contrat) tags.append(element("span", "tag", o.contrat));
  if (o.public) tags.append(element("span", "tag public", "Secteur public"));

  const bas = element("div", "bas");
  bas.append(tags, element("span", "source", `via ${o.source} ↗`));

  li.append(
    haut,
    titre,
    element("p", "entreprise", [o.entreprise, o.lieu].filter(Boolean).join(" · ")),
    bas,
    etoile,
  );
  return li;
}

// ---------- Filtres ----------

function filtresActifs() {
  const actifs = [];
  const recherche = $("recherche").value.trim();
  const lieu = $("lieu").value.trim();
  if (recherche) actifs.push({ libelle: `« ${recherche} »`, retirer: () => ($("recherche").value = "") });
  if (etat.categorie) actifs.push({ libelle: etat.categorie, retirer: () => choisir("categorie", "") });
  if (etat.contrat) actifs.push({ libelle: etat.contrat, retirer: () => choisir("contrat", "") });
  if (lieu) actifs.push({ libelle: lieu, retirer: () => ($("lieu").value = "") });
  if ($("public").checked) actifs.push({ libelle: "Secteur public", retirer: () => ($("public").checked = false) });
  if (etat.vue === "nouvelles") actifs.push({ libelle: "Nouvelles", retirer: () => choisirVue("") });
  if (etat.vue === "favoris") actifs.push({ libelle: "Favoris", retirer: () => choisirVue("") });
  return actifs;
}

function choisir(filtre, valeur) {
  etat[filtre] = valeur;
  document.querySelectorAll(`[data-filtre="${filtre}"] .puce`).forEach((p) =>
    p.setAttribute("aria-pressed", String(p.dataset.valeur === valeur)));
}

function choisirVue(vue) {
  etat.vue = vue;
  document.querySelectorAll("[data-vue]").forEach((p) => p.setAttribute("aria-pressed", String(p.dataset.vue === vue)));
}

function boutonAction(texte, action, classe = "bouton") {
  const b = element("button", classe, texte);
  b.type = "button";
  b.addEventListener("click", action);
  return b;
}

function etatVide(actifs) {
  const li = element("li", "vide");
  if (etat.vue === "favoris" && actifs.length === 1) {
    li.append(element("p", null, "Aucun favori pour l'instant. Touchez ☆ sur une offre pour la retrouver ici."));
    li.append(boutonAction("Voir toutes les offres", () => { choisirVue(""); afficher(); }));
    return li;
  }
  if (etat.vue === "nouvelles" && actifs.length === 1) {
    li.append(element("p", null, "Pas de nouvelle offre depuis votre dernière visite."));
    li.append(boutonAction("Voir toutes les offres", () => { choisirVue(""); afficher(); }));
    return li;
  }
  li.append(element("p", null, `Aucune offre ne correspond à : ${actifs.map((f) => f.libelle).join(" + ")}.`));
  const actions = element("div", "actions");
  for (const f of actifs) actions.append(boutonAction(`Retirer ${f.libelle}`, () => { f.retirer(); afficher(); }));
  const indeed = element("a", "bouton", "Chercher sur Indeed ↗");
  indeed.href = SITES[0].url.replace("{q}", encodeURIComponent($("recherche").value.trim() || "événementiel communication"));
  indeed.target = "_blank";
  indeed.rel = "noopener";
  actions.append(indeed);
  li.append(actions);
  return li;
}

function afficher() {
  const recherche = normaliser($("recherche").value);
  const lieu = normaliser($("lieu").value);
  const publicSeul = $("public").checked;

  const resultats = etat.offres.filter((o) =>
    (!etat.categorie || o.categorie === etat.categorie) &&
    (!etat.contrat || o.contrat === etat.contrat) &&
    (!publicSeul || o.public) &&
    (!lieu || normaliser(o.lieu).includes(lieu)) &&
    (!recherche || normaliser(`${o.titre} ${o.entreprise}`).includes(recherche)) &&
    (etat.vue !== "favoris" || favoris.has(o.id)) &&
    (etat.vue !== "nouvelles" || (estNouvelle(o) && !vues.has(o.id)))
  );

  const actifs = filtresActifs();
  const liste = $("liste");
  liste.replaceChildren(...resultats.map(carte));
  if (resultats.length === 0) liste.append(etatVide(actifs));

  const nouvelles = etat.offres.filter((o) => estNouvelle(o) && !vues.has(o.id)).length;
  const compteur = $("compteur");
  compteur.replaceChildren(element("strong", "chiffres", pluriel(resultats.length, "offre")));
  if (nouvelles && etat.vue !== "nouvelles") compteur.append(` · ${pluriel(nouvelles, "nouvelle")} depuis votre dernière visite`);
  $("nb-nouvelles").textContent = nouvelles || "";
  $("nb-favoris").textContent = favoris.size || "";

  const panneau = actifs.filter((f) => !["Nouvelles", "Favoris"].includes(f.libelle) && !f.libelle.startsWith("«"));
  $("nb-filtres").textContent = panneau.length ? `(${panneau.length})` : "";
  $("voir-resultats").textContent = `Voir ${pluriel(resultats.length, "offre")}`;

  const zone = $("filtres-actifs");
  zone.replaceChildren(...actifs.map((f) => {
    const b = boutonAction(f.libelle, () => { f.retirer(); afficher(); }, "puce retirable");
    b.setAttribute("aria-label", `Retirer le filtre ${f.libelle}`);
    return b;
  }));
  if (actifs.length > 1) {
    zone.append(boutonAction("Tout effacer", () => {
      actifs.forEach((f) => f.retirer());
      afficher();
    }, "lien-bouton"));
  }
}

// ---------- Panneau de filtres (feuille sur téléphone) ----------

function ouvrirFiltres(ouvert) {
  $("panneau-filtres").classList.toggle("ouvert", ouvert);
  $("voile").hidden = !ouvert;
  $("ouvrir-filtres").setAttribute("aria-expanded", String(ouvert));
  if (ouvert) $("fermer-filtres").focus();
  else $("ouvrir-filtres").focus();
}

// ---------- Autres sites ----------

function afficherSites() {
  for (const site of SITES) {
    const li = element("li", "site");
    li.append(element("span", null, site.nom));
    const liens = element("span", "liens");
    for (const mot of ["Événementiel", "Communication"]) {
      const a = element("a", "puce", `${mot} ↗`);
      a.href = site.url.replace("{q}", encodeURIComponent(mot.toLowerCase()));
      a.target = "_blank";
      a.rel = "noopener";
      a.setAttribute("aria-label", `${site.nom} : offres ${mot.toLowerCase()}`);
      liens.append(a);
    }
    li.append(liens);
    $("sites").append(li);
  }
}

// ---------- Démarrage ----------

async function demarrer() {
  afficherSites();
  try {
    const res = await fetch("data/offres.json", { cache: "no-store" });
    const donnees = await res.json();
    etat.offres = donnees.offres.sort((a, b) => new Date(b.date) - new Date(a.date));
    $("bandeau-exemple").hidden = !donnees.exemple;
    $("mise-a-jour").textContent = `Mis à jour ${depuis(donnees.miseAJour)}.`;
  } catch {
    $("compteur").textContent = "Impossible de charger les offres. Vérifiez votre connexion puis rechargez la page.";
    return;
  }

  $("recherche").addEventListener("input", afficher);
  $("lieu").addEventListener("input", afficher);
  $("public").addEventListener("change", afficher);
  document.querySelectorAll("[data-filtre]").forEach((groupe) =>
    groupe.querySelectorAll(".puce").forEach((puce) =>
      puce.addEventListener("click", () => {
        choisir(groupe.dataset.filtre, puce.dataset.valeur);
        afficher();
      })
    )
  );
  document.querySelectorAll("[data-vue]").forEach((puce) =>
    puce.addEventListener("click", () => {
      choisirVue(puce.dataset.vue);
      afficher();
    })
  );

  $("ouvrir-filtres").addEventListener("click", () => ouvrirFiltres(true));
  $("fermer-filtres").addEventListener("click", () => ouvrirFiltres(false));
  $("voir-resultats").addEventListener("click", () => ouvrirFiltres(false));
  $("voile").addEventListener("click", () => ouvrirFiltres(false));
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && $("panneau-filtres").classList.contains("ouvert")) ouvrirFiltres(false);
  });

  afficher();
}

demarrer();
