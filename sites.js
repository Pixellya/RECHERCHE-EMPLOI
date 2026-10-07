// Sites d'emploi proposés en bas de la page des offres, regroupés par catégorie.
// - url avec {q} : le site a une recherche ; {q} est remplacé par « événementiel »
//   ou « communication » (deux boutons).
//   Avec slug: true, {q} devient un mot sans accent (« evenementiel »), pour les
//   sites qui mettent le mot-clé dans le chemin de l'adresse.
// - url sans {q} : page des offres (un bouton « Offres »).

const GROUPES_SITES = [
  { nom: "Généralistes" },
  { nom: "Agrégateurs", aide: "Ces moteurs regroupent les annonces de nombreux autres sites." },
  { nom: "Événementiel" },
  { nom: "Culture et spectacle" },
  { nom: "Agences et lieux événementiels", aide: "Pages carrières des employeurs : candidatures en direct." },
  { nom: "Médias et musique", aide: "Pages carrières des employeurs : candidatures en direct." },
  { nom: "Jeunes diplômés" },
  { nom: "Secteur public", aide: "Mairies, départements, régions et établissements publics." },
];

const SITES = [
  // Généralistes
  { nom: "France Travail", groupe: "Généralistes", url: "https://candidat.francetravail.fr/offres/recherche?motsCles={q}&lieux=11R&typeContrat=CDI,CDD&offresPartenaires=true&tri=1" },
  { nom: "Indeed", groupe: "Généralistes", url: "https://fr.indeed.com/emplois?q={q}&l=%C3%8Ele-de-France&sort=date" },
  { nom: "LinkedIn", groupe: "Généralistes", url: "https://www.linkedin.com/jobs/search/?keywords={q}&location=%C3%8Ele-de-France%2C%20France&sortBy=DD" },
  { nom: "Welcome to the Jungle", groupe: "Généralistes", url: "https://www.welcometothejungle.com/fr/jobs?query={q}&aroundQuery=%C3%8Ele-de-France%2C%20France" },
  { nom: "HelloWork", groupe: "Généralistes", url: "https://www.hellowork.com/fr-fr/emploi/recherche.html?k={q}&l=%C3%8Ele-de-France" },
  { nom: "Apec", groupe: "Généralistes", url: "https://www.apec.fr/candidat/recherche-emploi.html/emploi?motsCles={q}&lieux=711" },
  { nom: "Cadremploi", groupe: "Généralistes", url: "https://www.cadremploi.fr/emploi/liste_offres?motscles={q}" },
  { nom: "Meteojob", groupe: "Généralistes", url: "https://www.meteojob.com/jobs?what={q}&where=%C3%8Ele-de-France" },
  { nom: "Le Figaro Emploi", groupe: "Généralistes", url: "https://emploi.lefigaro.fr/" },
  { nom: "Jobintree", groupe: "Généralistes", url: "https://www.jobintree.com/emploi/{q}/ile-de-france", slug: true },
  { nom: "Monster", groupe: "Généralistes", url: "https://www.monster.fr/emploi/recherche?q={q}&where=%C3%8Ele-de-France" },
  { nom: "Keljob", groupe: "Généralistes", url: "https://www.keljob.com/recherche?q={q}&l=%C3%8Ele-de-France" },
  { nom: "CadresOnline", groupe: "Généralistes", url: "https://www.cadresonline.com/" },
  { nom: "Direct Emploi", groupe: "Généralistes", url: "https://www.directemploi.com/lists-offre/?q={q}&localisation=Ile-de-France&localisation_field=ville" },
  { nom: "Embauche", groupe: "Généralistes", url: "https://www.embauche.fr/" },

  // Agrégateurs
  { nom: "Google (offres d'emploi)", groupe: "Agrégateurs", url: "https://www.google.com/search?q={q}+emploi+%C3%8Ele-de-France&ibp=htl;jobs" },
  { nom: "Jooble", groupe: "Agrégateurs", url: "https://fr.jooble.org/emploi-{q}/Ile+de+France", slug: true },
  { nom: "Trovit Emploi", groupe: "Agrégateurs", url: "https://emploi.trovit.fr/emploi-{q}-%C3%A0-%C3%AEle-de-france", slug: true },
  { nom: "Jobrapido", groupe: "Agrégateurs", url: "https://fr.jobrapido.com/Offres-d-emploi-pour-{q}-a-%C3%8Ele-De-France", slug: true },
  { nom: "Adzuna", groupe: "Agrégateurs", url: "https://www.adzuna.fr/ile-de-france/{q}", slug: true },
  { nom: "SimplyHired", groupe: "Agrégateurs", url: "https://www.simplyhired.fr/search?q={q}&l=%C3%8Ele-de-France" },
  { nom: "Jobted (Paris)", groupe: "Agrégateurs", url: "https://fr.jobted.com/emploi-{q}-%C3%A0-paris-(75)", slug: true },
  { nom: "Glassdoor", groupe: "Agrégateurs", url: "https://www.glassdoor.fr/Emploi/emplois.htm?sc.keyword={q}&locT=C&locId=2881970" },

  // Événementiel
  { nom: "Emploi-Événementiel", groupe: "Événementiel", url: "https://www.emploi-evenementiel.fr/offres-emploi.html" },

  // Culture et spectacle
  { nom: "ProfilCulture", groupe: "Culture et spectacle", url: "https://www.profilculture.com/annonce/index/liste/motcle/{q}" },
  { nom: "JobCulture : événementiel", groupe: "Culture et spectacle", url: "https://www.jobculture.fr/emplois-culture/emploi-evenementiel-stage/" },
  { nom: "JobCulture : communication", groupe: "Culture et spectacle", url: "https://www.jobculture.fr/emplois-culture/emploi-communication-stage/" },
  { nom: "ARTCENA", groupe: "Culture et spectacle", url: "https://www.artcena.fr/annonces/emplois" },
  { nom: "CPNEF-SV (liens vers les sites du spectacle vivant)", groupe: "Culture et spectacle", url: "https://www.cpnefsv.org/documentation/liens/offres-demploi" },
  { nom: "CFPTS", groupe: "Culture et spectacle", url: "https://www.cfpts.com/offres-emploi/" },
  { nom: "Théâtre contemporain", groupe: "Culture et spectacle", url: "https://www.theatre-contemporain.net/annonces/offres-emploi-remunere/" },
  { nom: "Syndeac", groupe: "Culture et spectacle", url: "https://www.syndeac.org/offres-emploi/" },
  { nom: "SNSP", groupe: "Culture et spectacle", url: "https://www.snsp.fr/espace-emploi/" },
  { nom: "La Lettre du Musicien", groupe: "Culture et spectacle", url: "https://lalettredumusicien.fr/lemploidumusicien" },
  { nom: "ODIA Normandie", groupe: "Culture et spectacle", url: "https://www.odianormandie.com/emploi" },
  { nom: "Mediajobs", groupe: "Culture et spectacle", url: "https://mediajobs.fr/candidats/mediajobs.asp" },
  { nom: "CIPAC (art contemporain)", groupe: "Culture et spectacle", url: "https://cipac.net/annonces/offres" },
  { nom: "AFJV (jeu vidéo, Paris)", groupe: "Culture et spectacle", url: "https://emploi.afjv.com/annonces-departement/75" },
  { nom: "Centre national de la danse", groupe: "Culture et spectacle", url: "https://www.cnd.fr/fr/auditions-offres-emploi" },

  // Agences et lieux événementiels
  { nom: "WMH Project", groupe: "Agences et lieux événementiels", url: "https://www.welcometothejungle.com/fr/companies/wmh-project/jobs" },
  { nom: "Hopscotch", groupe: "Agences et lieux événementiels", url: "https://www.welcometothejungle.com/fr/companies/hopscotch/jobs" },
  { nom: "Auditoire", groupe: "Agences et lieux événementiels", url: "https://www.auditoire.com/fr/jobs/" },
  { nom: "Publicis Live (portail Publicis France)", groupe: "Agences et lieux événementiels", url: "https://france.publicisgroupe.com/carrieres/" },
  { nom: "Havas France", groupe: "Agences et lieux événementiels", url: "https://www.welcometothejungle.com/fr/companies/havas-sa/jobs" },
  { nom: "Uzik", groupe: "Agences et lieux événementiels", url: "https://www.uzik.com/careers" },
  { nom: "Agence Chab", groupe: "Agences et lieux événementiels", url: "https://www.chabevents.com/careers" },
  { nom: "Wagram & Vous", groupe: "Agences et lieux événementiels", url: "https://www.welcometothejungle.com/fr/companies/wagram-vous/jobs" },
  { nom: "GL events", groupe: "Agences et lieux événementiels", url: "https://www.gl-events.com/en/careers" },
  { nom: "Viparis (dont le Palais des Congrès de Paris)", groupe: "Agences et lieux événementiels", url: "https://www.viparis.com/carrieres/nous-rejoindre/offres-d-emploi" },
  { nom: "Comexposium", groupe: "Agences et lieux événementiels", url: "https://careers.comexposium.com/jobs" },
  { nom: "RX France", groupe: "Agences et lieux événementiels", url: "https://jobs.rxglobal.com/jobs" },
  { nom: "JEC Group", groupe: "Agences et lieux événementiels", url: "https://www.jeccomposites.com/join-us/" },

  // Médias et musique
  { nom: "Groupe M6", groupe: "Médias et musique", url: "https://m6groupe-cand.talent-soft.com/offre-de-emploi/liste-toutes-offres.aspx" },
  { nom: "TF1", groupe: "Médias et musique", url: "https://www.welcometothejungle.com/fr/companies/groupe-tf1/jobs" },
  { nom: "France Télévisions", groupe: "Médias et musique", url: "https://recrutement.francetelevisions.fr/" },
  { nom: "Canal+ Group", groupe: "Médias et musique", url: "https://www.welcometothejungle.com/fr/companies/canal-group/jobs" },
  { nom: "Warner Music France", groupe: "Médias et musique", url: "https://www.welcometothejungle.com/fr/companies/warner-music-france/jobs" },
  { nom: "Universal Music France", groupe: "Médias et musique", url: "https://umusic.wd5.myworkdayjobs.com/UMGFRA" },
  { nom: "Sony Music France", groupe: "Médias et musique", url: "https://job-boards.greenhouse.io/sonymusiccareersfrance" },
  { nom: "Deezer", groupe: "Médias et musique", url: "https://www.deezerjobs.com/en/jobs/" },
  { nom: "NRJ Group", groupe: "Médias et musique", url: "https://www.nrjgroup.fr/fr/talents/" },
  { nom: "Believe", groupe: "Médias et musique", url: "https://careers.believe.com/en/jobs/" },

  // Jeunes diplômés
  { nom: "JobTeaser (Paris)", groupe: "Jeunes diplômés", url: "https://www.jobteaser.com/fr/job-search/offres-d-emploi-{q}-paris", slug: true },
  { nom: "L'Étudiant (CDI à Paris)", groupe: "Jeunes diplômés", url: "https://jobs-stages.letudiant.fr/offres/contrat-cdi-ville-paris" },
  { nom: "1 jeune 1 solution", groupe: "Jeunes diplômés", url: "https://www.1jeune1solution.gouv.fr/emplois?motCle={q}&page=1" },

  // Secteur public
  { nom: "Choisir le service public", groupe: "Secteur public", url: "https://choisirleservicepublic.gouv.fr/nos-offres/filtres/mot-cles/{q}/" },
  { nom: "Emploi Territorial", groupe: "Secteur public", url: "https://www.emploi-territorial.fr/emploi-mobilite/" },
  { nom: "La Gazette Emploi (Île-de-France)", groupe: "Secteur public", url: "https://emploi.lagazettedescommunes.com/emploi-territorial/ile-de-france-oll-1515" },
  { nom: "CIG Petite Couronne (92, 93, 94)", groupe: "Secteur public", url: "https://www.emploi-territorial.fr/emploi-mobilite/?search-col=99628" },
];
