// Affiche les offres de data/offres.json, de la plus récente à la plus ancienne,
// avec des filtres (recherche, lieu, catégorie, contrat).

const etat = { offres: [], categorie: "" };

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

function carte(o) {
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.className = "offre";
  a.href = o.url;
  a.target = "_blank";
  a.rel = "noopener";

  const h2 = document.createElement("h2");
  h2.textContent = o.titre;

  const infos = document.createElement("div");
  infos.className = "infos";
  infos.textContent = [o.entreprise, o.lieu, o.contrat].filter(Boolean).join(" · ");

  const bas = document.createElement("div");
  bas.className = "bas";
  const etiquette = document.createElement("span");
  etiquette.className = "etiquette" + (o.categorie === "Communication" ? " com" : "");
  etiquette.textContent = o.categorie;
  const date = document.createElement("span");
  date.className = "infos";
  date.textContent = `${ilYa(o.date)} · ${o.source}`;
  const voir = document.createElement("span");
  voir.className = "voir";
  voir.textContent = "Voir l'annonce →";
  bas.append(etiquette, date, voir);

  a.append(h2, infos, bas);
  li.append(a);
  return li;
}

function afficher() {
  const recherche = normaliser($("recherche").value);
  const lieu = normaliser($("lieu").value);
  const contrat = $("contrat").value;

  const resultats = etat.offres.filter((o) =>
    (!etat.categorie || o.categorie === etat.categorie) &&
    (!contrat || o.contrat === contrat) &&
    (!lieu || normaliser(o.lieu).includes(lieu)) &&
    (!recherche || normaliser(`${o.titre} ${o.entreprise}`).includes(recherche))
  );

  const liste = $("liste");
  liste.replaceChildren(...resultats.map(carte));
  if (resultats.length === 0) {
    const vide = document.createElement("li");
    vide.className = "vide";
    vide.textContent = "Aucune offre ne correspond à ces critères.";
    liste.append(vide);
  }
  $("compteur").textContent = `${resultats.length} offre${resultats.length > 1 ? "s" : ""}`;
}

async function demarrer() {
  try {
    const res = await fetch("data/offres.json", { cache: "no-store" });
    const donnees = await res.json();
    etat.offres = donnees.offres.sort((a, b) => new Date(b.date) - new Date(a.date));
    $("bandeau-exemple").hidden = !donnees.exemple;
    $("mise-a-jour").textContent =
      "Dernière mise à jour : " + new Date(donnees.miseAJour).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });

    const contrats = [...new Set(etat.offres.map((o) => o.contrat).filter(Boolean))].sort();
    for (const c of contrats) $("contrat").append(new Option(c, c));
  } catch {
    $("compteur").textContent = "Impossible de charger les offres.";
    return;
  }

  $("recherche").addEventListener("input", afficher);
  $("lieu").addEventListener("input", afficher);
  $("contrat").addEventListener("change", afficher);
  document.querySelectorAll(".puce").forEach((puce) =>
    puce.addEventListener("click", () => {
      document.querySelectorAll(".puce").forEach((p) => p.classList.remove("actif"));
      puce.classList.add("actif");
      etat.categorie = puce.dataset.categorie;
      afficher();
    })
  );
  afficher();
}

demarrer();
