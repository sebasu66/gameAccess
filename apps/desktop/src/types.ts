export type AvailabilityState = "ready" | "owned-busy" | "unavailable";

export interface CatalogGame {
  id: number;
  slug: string;
  name: string;
  app_id: number | null;
  credit_cost_per_hour: number;
  copies_total: number;
  copies_available: number;
  availability_state?: AvailabilityState;
  header_image?: string | null;
  capsule_image?: string | null;
  hero_image?: string | null;
  steam_url?: string | null;
  genres?: string[];
  categories?: string[];
  tags?: string[];
  developers?: string[];
  publishers?: string[];
  short_description?: string;
  release_date?: string | null;
  recommendation_count?: number | null;
  steam_review_score?: number | null;
  steam_review_count?: number | null;
  metacritic_score?: number | null;
  request_count_total?: number;
  successful_leases?: number;
  demand_value?: number;
  price_factor?: number;
  pool_value?: number;
  single_player?: boolean | null;
  multiplayer?: boolean | null;
  coop?: boolean | null;
  online_coop?: boolean | null;
  local_coop?: boolean | null;
  shared_split_screen?: boolean | null;
  mmo?: boolean | null;
  pvp?: boolean | null;
  local_account_labels?: string[];
  local_access_labels?: string[];
  local_primary_account_label?: string;
  local_owner_steam_ids?: string[];
  local_inventory_verified?: boolean;
  local_inventory_verified_at?: string | null;
}

export interface SteamSearchPrice {
  currency?: string | null;
  initial?: number | null;
  final?: number | null;
  discount_percent?: number;
}

export interface SteamSearchResult {
  app_id: number;
  name: string;
  image_url?: string | null;
  price?: SteamSearchPrice | null;
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
  catalog_game?: CatalogGame | null;
  access_state: "available" | "busy" | "not-in-pool";
  steam_url?: string;
}

export interface SteamSearchResponse {
  query: string;
  count: number;
  results: SteamSearchResult[];
}

export interface SteamScreenshot {
  id?: number;
  thumbnail?: string;
  full?: string;
}

export interface SteamMovie {
  id?: number;
  name?: string;
  thumbnail?: string;
  mp4?: string;
  webm?: string;
  hls_h264?: string;
  highlight?: boolean;
}

export interface SteamMetadata {
  app_id: number;
  name?: string;
  short_description?: string;
  about_the_game?: string;
  detailed_description?: string;
  developers?: string[];
  publishers?: string[];
  genres?: string[];
  categories?: string[];
  supported_languages?: string;
  release_date?: string;
  coming_soon?: boolean;
  required_age?: number | string;
  metacritic?: { score?: number; url?: string } | null;
  recommendation_count?: number;
  achievement_count?: number;
  price?: {
    currency?: string;
    initial?: number;
    final?: number;
    discount_percent?: number;
    initial_formatted?: string;
    final_formatted?: string;
  } | null;
  is_free?: boolean;
  windows?: boolean;
  mac?: boolean;
  linux?: boolean;
  minimum_requirements?: string;
  recommended_requirements?: string;
  screenshots?: SteamScreenshot[];
  movies?: SteamMovie[];
  header_image?: string;
  capsule_image?: string;
  hero_image?: string;
  background?: string;
  steam_url?: string;
  source?: string;
}

export interface GameDetails extends CatalogGame {
  steam: SteamMetadata | null;
  metadata_state: string;
  metadata_error?: string;
}

export interface UserSummary {
  id: number;
  username: string;
  credits: number;
}

export interface LeaseResponse {
  lease_id: number;
  user_id?: number;
  game: { id: number; name: string; app_id: number | null };
  account: { id: number; label: string; provider: string; user_id32?: number | null };
  credits_spent: number;
  credits_remaining: number;
  starts_at: string;
  expires_at: string;
  session_action: string;
}
