// Sites d'emploi proposés en bas de la page des offres, regroupés par catégorie.
// - url avec {q} : le site a une recherche ; {q} est remplacé par « événementiel »
//   ou « communication » (deux boutons).
// - url sans {q} : page des offres (un bouton « Offres »).

const GROUPES_SITES = [
  { nom: "Généralistes" },
  { nom: "Agrégateurs", aide: "Ces moteurs regroupent les annonces de nombreux autres sites." },
  { nom: "Culture et spectacle" },
  { nom: "Secteur public", aide: "Mairies, départements, régions et établissements publics." },
];

const SITES = [
  { nom: "France Travail", groupe: "Généralistes", url: "https://candidat.francetravail.fr/offres/recherche?motsCles={q}&lieux=11R&typeContrat=CDI,CDD&tri=1" },
  { nom: "Indeed", groupe: "Généralistes", url: "https://fr.indeed.com/jobs?q={q}&l=%C3%8Ele-de-France&sort=date" },
  { nom: "LinkedIn", groupe: "Généralistes", url: "https://www.linkedin.com/jobs/search/?keywords={q}&location=%C3%8Ele-de-France&sortBy=DD" },
  { nom: "Welcome to the Jungle", groupe: "Généralistes", url: "https://www.welcometothejungle.com/fr/jobs?query={q}&aroundQuery=%C3%8Ele-de-France" },
  { nom: "HelloWork", groupe: "Généralistes", url: "https://www.hellowork.com/fr-fr/emploi/recherche.html?k={q}&l=%C3%8Ele-de-France" },
  { nom: "Apec", groupe: "Généralistes", url: "https://www.apec.fr/candidat/recherche-emploi.html/emploi?motsCles={q}" },
  { nom: "Meteojob", groupe: "Généralistes", url: "https://www.meteojob.com/jobs?what={q}&where=%C3%8Ele-de-France" },
  { nom: "Google (offres d'emploi)", groupe: "Agrégateurs", url: "https://www.google.com/search?q={q}+emploi+%C3%8Ele-de-France&ibp=htl;jobs" },
  { nom: "Profilculture", groupe: "Culture et spectacle", url: "https://www.profilculture.com/annonce/recherche.aspx?mots={q}" },
  { nom: "Emploi Territorial", groupe: "Secteur public", url: "https://www.emploi-territorial.fr/emploi-mobilite/?search-word={q}" },
  { nom: "Choisir le service public", groupe: "Secteur public", url: "https://choisirleservicepublic.gouv.fr/nos-offres/filtres/mot-cles/{q}/" },
];
