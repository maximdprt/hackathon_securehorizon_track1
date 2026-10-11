/* The city's districts. A chain lives in the district of what it is for,
   read from its category in the catalog (constants/l1-chains.json).
   Downtown is the Primary Network. A chain the catalog does not describe
   yet stands on the Frontier, as does every new L1 until the catalog
   knows it. The order is the city's, clockwise on screen from the
   boulevard behind downtown: Finance faces the viewer, and the Frontier
   is the city's far edge. */

// AVAGUARD: an eighth district, "security": agents protected, payment checks and audit proofs (our L1 stands in it)
export type District = "gaming" | "culture" | "enterprise" | "finance" | "security" | "ai" | "infrastructure" | "frontier";

// AVAGUARD: the page is in French, so are the districts' names and what they are for
export const DISTRICTS: { key: District; label: string; about: string }[] = [
  { key: "gaming", label: "Jeux", about: "Mondes de jeu et leurs économies" },
  { key: "culture", label: "Culture", about: "Sport, musique, médias et fans" },
  { key: "enterprise", label: "Entreprise", about: "Industrie, identité, fidélité et télécoms" },
  { key: "finance", label: "Finance", about: "Paiements, échanges, règlement et actifs réels" },
  // AVAGUARD: right after Finance, so our ward stands beside the front ward, toward the viewer
  { key: "security", label: "Sécurité", about: "Agents protégés, contrôles de paiement et preuves d'audit" },
  { key: "ai", label: "IA", about: "Agents, modèles et les données dont ils apprennent" },
  { key: "infrastructure", label: "Infrastructure", about: "Données, connectivité et chaînes généralistes" },
  { key: "frontier", label: "Frontière", about: "Les L1 que l'annuaire ne décrit pas encore, et les nouvelles L1 de la semaine" },
];

/** the order the list and the phone's browser show the districts in, finance first; the city's plan keeps DISTRICTS' order */
export const LIST_ORDER: District[] = ["finance", "security", "enterprise", "ai", "gaming", "culture", "infrastructure", "frontier"]; // AVAGUARD: + security

/** the district that faces the viewer */
export const FRONT: District = "finance";

const BY_CATEGORY: Record<string, District> = {
  Gaming: "gaming",
  Finance: "finance",
  Enterprise: "enterprise",
  Trade: "enterprise",
  Automotive: "enterprise",
  Energy: "enterprise",
  Telecom: "enterprise",
  Loyalty: "enterprise",
  Sports: "culture",
  Music: "culture",
  Media: "culture",
  Collectibles: "culture",
  SocialFi: "culture",
  Ticketing: "culture",
  Fitness: "culture",
  AI: "ai",
  Infrastructure: "infrastructure",
  General: "infrastructure",
};

export function districtOf(category: string | null | undefined): District {
  return (category && BY_CATEGORY[category]) || "frontier";
}

export const districtLabel = (d: District) => DISTRICTS.find((x) => x.key === d)?.label ?? d;
export const districtAbout = (d: District) => DISTRICTS.find((x) => x.key === d)?.about ?? "";
