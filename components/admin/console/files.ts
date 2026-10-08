import { Platform } from "react-native";

export type CsvColumn<T> = { label: string; value: (row: T) => string | number | boolean | null | undefined };

function escapeCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV lisible directement par Excel en français : séparateur « ; » et marque d'ordre des octets UTF-8
 * pour que les accents s'affichent correctement.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]) {
  const lines = [columns.map((column) => escapeCell(column.label)).join(";"), ...rows.map((row) => columns.map((column) => escapeCell(column.value(row))).join(";"))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Nom de fichier daté : `pharmagarde-annuaire-2026-10-08.csv`. */
export function datedFileName(prefix: string, extension = "csv", now = new Date()) {
  return `pharmagarde-${prefix}-${now.toISOString().slice(0, 10)}.${extension}`;
}

/** Télécharge un fichier depuis le navigateur. Renvoie false hors du web (export indisponible). */
export function downloadFile(fileName: string, content: string, mimeType = "text/csv;charset=utf-8") {
  if (Platform.OS !== "web" || typeof document === "undefined") return false;
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Ouvre le sélecteur de fichiers du navigateur. Renvoie null s'il est annulé ou hors du web. */
export function pickFile(accept: string): Promise<File | null> {
  if (Platform.OS !== "web" || typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export const isWeb = Platform.OS === "web";
