import { assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert";
import { delay } from "jsr:@std/async/delay";
import { generateShortCode } from "../src/db.ts";

Deno.test("URL Shortener", async (t) => {
    await t.step("should generate a short code for a valid url", async () => {
        const longurl = "https://www.example.com/some/long/path";
        const shortCode = await generateShortCode(longurl);

        assertEquals(typeof shortCode, "string");
        assertEquals(shortCode.length, 11);
    });

    await t.step("should be unique for each timestamp", async () => {
        const longurl = "https://deno.land";
        const shortCode1 = await generateShortCode(longurl);
        await delay(100);
        const shortCode2 = await generateShortCode(longurl);

        assertNotEquals(shortCode1, shortCode2);
    });

    await t.step("should throw error for invalid URLs", async () => {
        const longurl = "invalid-url";
        await assertRejects(() => generateShortCode(longurl), Error);
    });
});
