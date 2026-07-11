/**
 * Headless Obsidian Engine CLI Runner & Watch Daemon — Statenour OS
 *
 * Orchestrates doctor, ingest, export, sync, status, and watch mode commands.
 */

import "dotenv/config";
import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";
import {
  getObsidianEngineConfig,
  readEngineStatus,
  writeEngineStatus,
} from "../lib/obsidian/engine-config";
import type {
  ObsidianEngine