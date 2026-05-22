import companiesData from '@/data/companies.json';

export interface Company {
  name: string;
  keywords: string[];
  feeds: { name: string; url: string }[];
}

let runtimeData: Record<string, Company> = JSON.parse(
  JSON.stringify(companiesData),
);

export function getAllCompanies(): Company[] {
  return Object.values(runtimeData);
}

export function getCompany(name: string): Company | null {
  const key = Object.keys(runtimeData).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  return key ? runtimeData[key] : null;
}

export function updateCompanyKeywords(
  name: string,
  keywords: string[],
): Company | null {
  const key = Object.keys(runtimeData).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  if (!key) return null;
  runtimeData[key].keywords = keywords.map((k) => k.trim()).filter(Boolean);
  return runtimeData[key];
}

export function resolveCompanyName(input: string): string | null {
  const q = input.toLowerCase().trim();
  const names = Object.keys(runtimeData);
  for (const n of names) if (n.toLowerCase() === q) return n;
  for (const n of names) if (q.includes(n.toLowerCase())) return n;
  const aliases: Record<string, string> = {
    glaxosmithkline: 'GSK',
    glaxo: 'GSK',
    beigene: 'BeOne',
    'be one': 'BeOne',
  };
  for (const [alias, target] of Object.entries(aliases)) {
    if (q.includes(alias)) return target;
  }
  return null;
}
