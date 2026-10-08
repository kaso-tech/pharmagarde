import { useState } from "react";

import { isWeb } from "./files";
import { Button } from "./ui";

/** Bouton d'export : lance `run` (récupération + téléchargement), affiche le chargement. Web seulement. */
export function ExportButton({ label = "Exporter (CSV)", run }: { label?: string; run: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  if (!isWeb) return null;
  return (
    <Button
      label={label}
      icon="download"
      loading={pending}
      onPress={async () => {
        setPending(true);
        try {
          await run();
        } finally {
          setPending(false);
        }
      }}
    />
  );
}
