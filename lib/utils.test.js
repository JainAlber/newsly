import { envInt, clampPositive } from "./utils";

describe("envInt", () => {
  const KEY = "TEST_ENV_INT";

  afterEach(() => {
    delete process.env[KEY];
  });

  test("parses a normal numeric string", () => {
    process.env[KEY] = "42";
    expect(envInt(KEY, 3)).toBe(42);
  });

  test("falls back when the var is missing", () => {
    expect(envInt(KEY, 7)).toBe(7);
  });

  test("falls back on NaN-producing input", () => {
    process.env[KEY] = "12abc";
    expect(envInt(KEY, 9)).toBe(9);
  });

  test("preserves an explicit zero (does not fall back)", () => {
    process.env[KEY] = "0";
    expect(envInt(KEY, 500)).toBe(0);
  });

  test("parses a negative value", () => {
    process.env[KEY] = "-5";
    expect(envInt(KEY, 3)).toBe(-5);
  });

  test('falls back on "garbage"', () => {
    process.env[KEY] = "garbage";
    expect(envInt(KEY, 3)).toBe(3);
  });
});

describe("clampPositive", () => {
  test("returns the value when above min", () => {
    expect(clampPositive(5, 1)).toBe(5);
  });

  test("clamps zero up to min", () => {
    expect(clampPositive(0, 1)).toBe(1);
  });

  test("clamps a negative value up to min", () => {
    expect(clampPositive(-3, 1)).toBe(1);
  });

  test("clamps a value below min up to min", () => {
    expect(clampPositive(2, 5)).toBe(5);
  });
});
