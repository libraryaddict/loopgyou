import {
  equip,
  equippedAmount,
  equippedItem,
  Familiar,
  familiarWeight,
  Item,
  Slot,
  toSlot,
  useFamiliar,
  weaponHands,
} from "kolmafia";
import { $familiar, $item, $skill, $slot, $slots, get, have, Requirement } from "libram";
import { Task } from "./tasks/structure";
import { canChargeVoid, Resource } from "./resources";

// Adapted from phccs
export class Outfit {
  equips: Map<Slot, Item> = new Map<Slot, Item>();
  accesories: Item[] = [];
  familiar?: Familiar;
  modifier?: string;

  equip(item?: Item | Familiar | (Item | Familiar)[]): boolean {
    if (item === undefined) return true;
    if (Array.isArray(item)) return item.every((val) => this.equip(val));
    if (!have(item)) return false;

    if (item instanceof Item) {
      const slot = toSlot(item);
      if (slot === $slot`acc1`) {
        if (this.accesories.length >= 3) return false;
        this.accesories.push(item);
        return true;
      }
      if (!this.equips.has(slot)) {
        this.equips.set(slot, item);
        return true;
      }
      if (
        slot === $slot`weapon` &&
        !this.equips.has($slot`off-hand`) &&
        have($skill`Double-Fisted Skull Smashing`) &&
        weaponHands(item)
      ) {
        this.equips.set($slot`off-hand`, item);
        return true;
      }
      if (
        slot === $slot`off-hand` &&
        have($familiar`Left-Hand Man`) &&
        this.familiar === undefined &&
        !this.equips.has($slot`familiar`)
      ) {
        if (item === $item`cursed magnifying glass` && !canChargeVoid()) {
          // Cursed magnifying glass cannot trigger in Lefty
          this.equips.set($slot`familiar`, this.equips.get($slot`off-hand`) ?? $item`none`);
          this.equips.set($slot`off-hand`, item);
        } else {
          this.familiar = $familiar`Left-Hand Man`;
          this.equips.set($slot`familiar`, item);
        }
        return true;
      }
      return false;
    } else {
      if (this.familiar) return false;
      if (!have(item)) return false;
      this.familiar = item;
      return true;
    }
  }

  equipFirst<T extends Resource>(resources: T[]): T | undefined {
    for (const resource of resources) {
      if (!resource.available()) continue;
      if (resource.chance && resource.chance() === 0) continue;
      if (!this.canEquip(resource.equip)) continue;
      if (!this.equip(resource.equip)) continue;
      return resource;
    }
    return undefined;
  }

  equipUntilCapped<T extends Resource>(resources: T[]): T[] {
    const result: T[] = [];
    for (const resource of resources) {
      if (!resource.available()) continue;
      if (resource.chance && resource.chance() === 0) continue;
      if (!this.canEquip(resource.equip)) continue;
      if (!this.equip(resource.equip)) continue;
      result.push(resource);
      if (resource.chance && resource.chance() === 1) break;
    }
    return result;
  }

  canEquip(item?: Item | Familiar | (Item | Familiar)[]): boolean {
    if (item === undefined) return true;
    if (Array.isArray(item)) return item.every((val) => this.canEquip(val)); // TODO: smarter
    if (!have(item)) return false;

    if (item instanceof Item) {
      const slot = toSlot(item);
      if (slot === $slot`acc1`) {
        if (this.accesories.length >= 3) return false;
        return true;
      }
      if (!this.equips.has(slot)) {
        return true;
      }
      if (
        slot === $slot`weapon` &&
        !this.equips.has($slot`off-hand`) &&
        have($skill`Double-Fisted Skull Smashing`) &&
        weaponHands(item)
      ) {
        return true;
      }
      if (
        slot === $slot`off-hand` &&
        have($familiar`Left-Hand Man`) &&
        this.familiar === undefined &&
        !this.equips.has($slot`familiar`)
      ) {
        return true;
      }
      return false;
    } else {
      if (this.familiar) return false;
      if (!have(item)) return false;
      return true;
    }
  }

  dress(): void {
    if (this.familiar) useFamiliar(this.familiar);
    const targetEquipment = Array.from(this.equips.values());
    const accessorySlots = $slots`acc1, acc2, acc3`;
    for (const slot of $slots`weapon, off-hand, hat, shirt, pants, familiar, buddy-bjorn, crown-of-thrones, back`) {
      if (
        targetEquipment.includes(equippedItem(slot)) &&
        this.equips.get(slot) !== equippedItem(slot)
      )
        equip(slot, $item`none`);
    }

    //Order is anchored here to prevent DFSS shenanigans
    for (const slot of $slots`weapon, off-hand, hat, back, shirt, pants, familiar, buddy-bjorn, crown-of-thrones`) {
      const equipment = this.equips.get(slot);
      if (equipment) equip(slot, equipment);
    }

    //We don't care what order accessories are equipped in, just that they're equipped
    const accessoryEquips = this.accesories;
    for (const slot of accessorySlots) {
      const toEquip = accessoryEquips.find(
        (equip) =>
          equippedAmount(equip) < accessoryEquips.filter((accessory) => accessory === equip).length
      );
      if (!toEquip) break;
      const currentEquip = equippedItem(slot);
      //We never want an empty accessory slot
      if (
        currentEquip === $item`none` ||
        equippedAmount(currentEquip) >
          accessoryEquips.filter((accessory) => accessory === currentEquip).length
      ) {
        equip(slot, toEquip);
      }
    }

    if (this.modifier) {
      // Handle familiar equipment manually to avoid weird Left-Hand Man behavior
      const fam_equip = this.equips.get($slot`familiar`);
      if (fam_equip !== undefined) {
        const index = targetEquipment.indexOf(fam_equip);
        if (index > -1) targetEquipment.splice(index, 1);
      }

      let requirements = Requirement.merge([
        new Requirement([this.modifier], {
          forceEquip: targetEquipment.concat(...accessoryEquips),
        }),
      ]);

      if (fam_equip !== undefined) {
        requirements = Requirement.merge([
          requirements,
          new Requirement([], { preventSlot: [$slot`familiar`] }),
        ]);
      }

      requirements = Requirement.merge([
        requirements,
        new Requirement([], { preventSlot: [$slot`back`] }),
      ]);

      if (!requirements.maximize()) {
        throw `Unable to maximize ${this.modifier}`;
      }
    }
  }

  static create(task: Task): Outfit {
    const spec = typeof task.outfit === "function" ? task.outfit() : task.outfit;

    const outfit = new Outfit();
    for (const item of spec?.equip ?? []) outfit.equip(item);
    if (spec?.familiar) outfit.equip(spec.familiar);

    if (spec?.modifier) {
      // Run maximizer
      if (spec.modifier.includes("item")) {
        if (
          outfit.canEquip($item`li'l ninja costume`) &&
          outfit.canEquip($familiar`Trick-or-Treating Tot`)
        ) {
          outfit.equip($item`li'l ninja costume`);
          outfit.equip($familiar`Trick-or-Treating Tot`);
        } else {
          outfit.equip($familiar`Jumpsuited Hound Dog`);
        }
      }
      if (spec.modifier.includes("+combat")) outfit.equip($familiar`Jumpsuited Hound Dog`);
      if (spec.modifier.includes("meat")) outfit.equip($familiar`Hobo Monkey`);
      if (spec.modifier.includes("init")) outfit.equip($familiar`Oily Woim`);
      outfit.modifier = spec.modifier;
    }

    return outfit;
  }

  public equipDefaults(): void {
    if (this.modifier?.includes("-combat")) this.equip($familiar`Disgeist`); // low priority

    // eslint-disable-next-line libram/verify-constants
    if (familiarWeight($familiar`Grey Goose`) < 6) {
      // eslint-disable-next-line libram/verify-constants
      this.equip($familiar`Grey Goose`);
      this.equip($item`yule hatchet`);
      this.equip($item`familiar scrapbook`);
    } else if (get("camelSpit") < 100) {
      this.equip($familiar`Melodramedary`);
    } else if (have($familiar`Temporal Riftlet`)) {
      this.equip($familiar`Temporal Riftlet`);
    } else if (have($item`gnomish housemaid's kgnee`)) {
      this.equip($familiar`Reagnimated Gnome`);
    } else this.equip($familiar`Galloping Grill`);
    this.equip($familiar`Melodramedary`);

    const commonFamiliarEquips = new Map<Familiar, Item>([
      // eslint-disable-next-line libram/verify-constants
      [$familiar`Grey Goose`, $item`grey down vest`],
      [$familiar`Melodramedary`, $item`dromedary drinking helmet`],
      [$familiar`Reagnimated Gnome`, $item`gnomish housemaid's kgnee`],
    ]);
    const familiarEquip = commonFamiliarEquips.get(this.familiar ?? $familiar`none`);
    if (familiarEquip && this.canEquip(familiarEquip)) this.equip(familiarEquip);

    if (!this.modifier) {
      // Default outfit
      this.equip($item`ice crown`);
      this.equip($item`industrial fire extinguisher`);
      this.equip($item`miniature crystal ball`);
      this.equip($item`familiar scrapbook`);
      this.equip($item`unwrapped knock-off retro superhero cape`);
      this.equip($item`Cargo Cultist Shorts`);
      this.equip($item`backup camera`);
      // eslint-disable-next-line libram/verify-constants
      this.equip($item`combat lover's locket`);
      this.equip($item`Powerful Glove`);
    }
  }
}
