/** Crop parameters and rotation templates (data/crops.json, data/rotations.json), validated once. */
import cropsJson from "../../data/crops.json";
import rotationsJson from "../../data/rotations.json";
import { cropsFileSchema, indexCrops, type Crop } from "./crops";
import { rotationsFileSchema, type Rotation, type RotationYear } from "./rotations";

export const CROP_LIST: readonly Crop[] = cropsFileSchema.parse(cropsJson).crops;
export const CROPS: ReadonlyMap<string, Crop> = indexCrops(CROP_LIST);
export const ROTATION_TEMPLATES: readonly Rotation[] = rotationsFileSchema.parse(rotationsJson).rotations;

/** Fixed colour slot (1–6) of each plant family, so a family keeps its colour in every chart. */
export const FAMILY_SLOT: Readonly<Record<string, number>> = {
  Malvaceae: 1,
  Poaceae: 2,
  Fabaceae: 3,
  Asteraceae: 4,
  Solanaceae: 5,
  Cucurbitaceae: 6,
};

/** Crops of a rotation, each once, in order of appearance. */
export function rotationCrops(years: readonly RotationYear[]): Crop[] {
  const ids = [...new Set(years.flatMap((y) => (y.second === null ? [y.main] : [y.main, y.second])))];
  return ids.flatMap((id) => {
    const crop = CROPS.get(id);
    return crop === undefined ? [] : [crop];
  });
}
