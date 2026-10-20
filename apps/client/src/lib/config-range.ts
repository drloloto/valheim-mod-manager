// BepInEx writes "# Acceptable value range: From 0 to 100" for bounded numbers. That becomes a slider;
// the step follows the type (integers step 1, floats 0.01 or finer for small ranges).

export interface Range {
	min: number;
	max: number;
	step: number;
}

const FROM_TO = /^from\s+(-?[\d.]+)\s+to\s+(-?[\d.]+)$/i;

export function parseRange(acceptable: string | undefined, type: string | undefined): Range | null {
	const m = acceptable?.trim().match(FROM_TO);
	if (!m) return null;
	const min = Number(m[1]);
	const max = Number(m[2]);
	if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
	const integer = /^(int|uint|long|short|byte)/i.test(type ?? "") || (!type && Number.isInteger(min) && Number.isInteger(max) && max - min >= 10);
	const span = max - min;
	const step = integer ? 1 : span <= 1 ? 0.01 : span <= 10 ? 0.05 : span <= 100 ? 0.5 : 1;
	return { min, max, step };
}
