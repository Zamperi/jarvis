// src/devTest.ts
import { writeFileSafe } from "../src/tools/fileTools";

async function run() {
  console.log("Testataan OK-kirjoitus...");
  await writeFileSafe("playground/test-ok.txt", "ok");

  console.log("Testataan JUUREN ULKOPUOLELLE kirjoitus...");
  try {
    await writeFileSafe("../blocked.txt", "blocked");
  } catch (err) {
    console.error("Odotettu virhe:", (err as Error).message);
  }
}

run().catch((e) => {
  console.error("Yleistason virhe devTestissä:", e);
});
