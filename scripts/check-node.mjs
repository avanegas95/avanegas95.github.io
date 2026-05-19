const minimum = "22.12.0";

function parseVersion(version) {
  return version.split(".").map((part) => Number.parseInt(part, 10));
}

function isSupported(current, required) {
  const currentParts = parseVersion(current);
  const requiredParts = parseVersion(required);

  for (let index = 0; index < requiredParts.length; index += 1) {
    const currentPart = currentParts[index] ?? 0;
    const requiredPart = requiredParts[index] ?? 0;

    if (currentPart > requiredPart) return true;
    if (currentPart < requiredPart) return false;
  }

  return true;
}

const current = process.versions.node;

if (!isSupported(current, minimum)) {
  console.error(
    `\nNode.js v${current} is not supported. Use v${minimum} or newer (see .nvmrc).\n` +
      `Example: nvm install && nvm use\n`,
  );
  process.exit(1);
}
