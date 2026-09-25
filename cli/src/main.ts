#!/usr/bin/env node
import process from "node:process";
import { run } from "./commands.js";

// Duenner Einstieg: die Befehle liegen in `commands.ts`, damit sie ohne
// Kindprozess testbar sind (2.17). Der Exit-Code kommt von `run`.
process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
