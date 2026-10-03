import type { ApplicationRepository } from "./repository-contracts";

export function downloadRawBackup(repository: ApplicationRepository) {
  const text = repository.exportRaw();
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `yi-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
