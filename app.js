// Affiche les offres de data/offres.json, de la plus récente à la plus ancienne,
// avec des filtres (recherche, lieu, catégorie, contrat, secteur public).

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

const etat = { offres: [], categorie: "", contrat: "" };

const $ = (id) => document.getElementById(id);

function ilYa(date) {
  const jours = Math.floor((Date.now() - new Date(date)) / 86400000);
  if (jours <= 0) return "Aujourd'hui";
  if (jours === 1) return "Hier";
  return `Il y a ${jours} jours`;
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

function carte(o) {
  const a = element("a", "offre");
  a.href = o.url;
  a.target = "_blank";
  a.rel = "noopener";

  const bas = element("div", "bas");
  const etiquettes = element("span", "etiquettes");
  etiquettes.append(element("span", "etiquette" + (o.categorie === "Communication" ? " com" : ""), o.categorie));
  if (o.public) etiquettes.append(element("span", "etiquette pub", "Secteur public"));
  bas.append(etiquettes, element("span", "infos", `${ilYa(o.date)} · ${o.source}`), element("span", "voir", "Voir l'annonce →"));

  a.append(
    element("h2", null, o.titre),
    element("div", "infos", [o.entreprise, o.lieu, o.contrat].filter(Boolean).join(" · ")),
    bas,
  );
  const li = element("li");
  li.append(a);
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
    (!recherche || normaliser(`${o.titre} ${o.entreprise}`).includes(recherche))
  );

  const liste = $("liste");
  liste.replaceChildren(...resultats.map(carte));
  if (resultats.length === 0) liste.append(element("li", "vide", "Aucune offre ne correspond à ces critères."));
  $("compteur").textContent = `${resultats.length} offre${resultats.length > 1 ? "s" : ""}`;
}

function afficherSites() {
  for (const site of SITES) {
    const li = element("li", "site");
    li.append(element("span", null, site.nom));
    const liens = element("span", "liens");
    for (const mot of ["Événementiel", "Communication"]) {
      const a = element("a", "puce", mot);
      a.href = site.url.replace("{q}", encodeURIComponent(mot.toLowerCase()));
      a.target = "_blank";
      a.rel = "noopener";
      liens.append(a);
    }
    li.append(liens);
    $("sites").append(li);
  }
}

async function demarrer() {
  afficherSites();
  try {
    const res = await fetch("data/offres.json", { cache: "no-store" });
    const donnees = await res.json();
    etat.offres = donnees.offres.sort((a, b) => new Date(b.date) - new Date(a.date));
    $("bandeau-exemple").hidden = !donnees.exemple;
    $("mise-a-jour").textContent =
      "Dernière mise à jour : " + new Date(donnees.miseAJour).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
  } catch {
    $("compteur").textContent = "Impossible de charger les offres.";
    return;
  }

  $("recherche").addEventListener("input", afficher);
  $("lieu").addEventListener("input", afficher);
  $("public").addEventListener("change", afficher);
  document.querySelectorAll("[data-filtre]").forEach((groupe) =>
    groupe.querySelectorAll(".puce").forEach((puce) =>
      puce.addEventListener("click", () => {
        groupe.querySelectorAll(".puce").forEach((p) => p.classList.remove("actif"));
        puce.classList.add("actif");
        etat[groupe.dataset.filtre] = puce.dataset.valeur;
        afficher();
      })
    )
  );
  afficher();
}

demarrer();
