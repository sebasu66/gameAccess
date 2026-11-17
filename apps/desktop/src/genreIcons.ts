import {
  Accessibility, Axe, BookOpen, Box, Calculator, Car, Castle, Clapperboard, Code, Coffee, Compass, Cog, Crosshair, Dices,
  Footprints, Gamepad2, Ghost, Gift, GraduationCap, Headphones, Hourglass, Joystick, Layers, Map as MapIcon, Mic,
  MousePointerClick, Music, Palette, Puzzle, Rocket, Scroll, Sparkles, Swords, Target, Trophy, Users, Wrench,
  type LucideIcon,
} from "lucide-react";

/** One icon per genre concept (see genreConcepts.json); unknown genres fall back to a gamepad. */
const ICONS: Record<string, LucideIcon> = {
  action: Swords,
  adventure: Compass,
  indie: Sparkles,
  casual: Coffee,
  simulation: Cog,
  strategy: Castle,
  rpg: Scroll,
  free_to_play: Gift,
  early_access: Hourglass,
  sports: Trophy,
  racing: Car,
  massively_multiplayer: Users,
  puzzle: Puzzle,
  shooter: Crosshair,
  platformer: Footprints,
  visual_novel: BookOpen,
  arcade: Joystick,
  point_and_click: MousePointerClick,
  turn_based_strategy: Layers,
  real_time_strategy: Rocket,
  card_and_board: Dices,
  tactical: Target,
  fighting: Swords,
  hack_and_slash: Axe,
  music: Music,
  horror: Ghost,
  utilities: Wrench,
  design_illustration: Palette,
  video_production: Clapperboard,
  animation_modeling: Box,
  photo_editing: Palette,
  web_publishing: MapIcon,
  audio_production: Headphones,
  game_development: Code,
  education: GraduationCap,
  accounting: Calculator,
  software_training: GraduationCap,
  programming: Code,
  voice: Mic,
  accessibility: Accessibility,
};

export function genreIcon(id: string): LucideIcon {
  return ICONS[id] ?? Gamepad2;
}

/** Position of a known genre in the curated order, or -1 for the long tail of small genres. */
export function genreRank(id: string): number {
  return Object.keys(ICONS).indexOf(id);
}
