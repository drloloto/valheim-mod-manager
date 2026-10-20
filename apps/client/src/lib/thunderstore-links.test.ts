import { describe, expect, it } from "vite-plus/test";
import { packageIdFromUrl } from "./thunderstore-links";

describe("packageIdFromUrl", () => {
	it("recognizes Valheim package pages in both URL styles", () => {
		expect(packageIdFromUrl("https://thunderstore.io/c/valheim/p/ValheimModding/Jotunn/")).toBe("ValheimModding-Jotunn");
		expect(packageIdFromUrl("https://thunderstore.io/c/valheim/p/Advize/PlantEverything")).toBe("Advize-PlantEverything");
		expect(packageIdFromUrl("https://valheim.thunderstore.io/package/denikson/BepInExPack_Valheim/")).toBe("denikson-BepInExPack_Valheim");
		expect(packageIdFromUrl("https://thunderstore.io/c/valheim/p/A/B/?utm=x#top")).toBe("A-B");
		expect(packageIdFromUrl("https://valheim.hexium.gg/mods/ValheimModding/Jotunn")).toBe("ValheimModding-Jotunn");
	});

	it("leaves other links alone", () => {
		expect(packageIdFromUrl("https://thunderstore.io/c/lethal-company/p/A/B/")).toBeNull();
		expect(packageIdFromUrl("https://thunderstore.io/c/valheim/p/A/B/wiki/")).toBeNull();
		expect(packageIdFromUrl("https://github.com/Valheim-Modding/Jotunn")).toBeNull();
		expect(packageIdFromUrl("mailto:someone@example.com")).toBeNull();
	});
});
