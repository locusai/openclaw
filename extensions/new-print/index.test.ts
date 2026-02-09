import { describe, expect, it } from "vitest";
import { parseNewPrintArg } from "./index.js";

describe("new-print plugin parser", () => {
  it("parses --print with space form", () => {
    expect(parseNewPrintArg("/new --print hello world")).toBe("hello world");
  });

  it("parses --print= form", () => {
    expect(parseNewPrintArg("/new --print=hello world")).toBe("hello world");
  });

  it("parses quoted values", () => {
    expect(parseNewPrintArg('/new --print="hello world"')).toBe("hello world");
    expect(parseNewPrintArg("/new --print 'hello world'")).toBe("hello world");
  });

  it("returns null for non-matching input", () => {
    expect(parseNewPrintArg("/new")).toBeNull();
    expect(parseNewPrintArg("/new --persona foo")).toBeNull();
  });
});
