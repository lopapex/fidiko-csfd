import { describe, expect, it } from "vitest";
import { decodeHtmlEntities } from "./text";

describe("text helpers", () => {
  it("decodes common HTML entities from external titles", () => {
    expect(decodeHtmlEntities("Minions &amp; Monsters")).toBe("Minions & Monsters");
    expect(decodeHtmlEntities("Minions&nbsp;&amp;&nbsp;Monsters")).toBe("Minions & Monsters");
    expect(decodeHtmlEntities("A &#268;&#225;st")).toBe("A Část");
  });
});
