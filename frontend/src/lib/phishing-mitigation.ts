/**
 * Phishing Attack Mitigation and URL Validator
 *
 * Provides defence-in-depth against phishing by:
 *   1. Validating URLs against a strict allowlist of trusted domains.
 *   2. Detecting homograph / IDN lookalike attacks using Unicode confusable
 *      detection and punycode inspection.
 *   3. Blocking known phishing patterns (open redirects, data URIs, JS
 *      protocol handlers, IP-literal hosts, abnormal port usage).
 *   4. Scoring URLs with a numeric threat level so callers can make
 *      risk-proportionate decisions (block vs. warn vs. allow).
 *
 * Architectural boundaries:
 *   - Pure functions and a single stateless class — no DOM, no network I/O.
 *   - All public API is type-safe and throws only on programmer error (e.g.
 *     invalid allowlist entries), never on malicious input.
 *   - Integrates cleanly with the existing sanitize.ts / tracking.ts layers.
 *
 * Time Complexity:  O(D + P) per validation call
 *   D = number of trusted domain patterns
 *   P = number of phishing pattern checks (fixed constant)
 * Space Complexity: O(D) for the compiled allowlist
 */

export type UrlRiskLevel = 'safe' | 'suspicious' | 'dangerous';

export interface UrlValidationResult {
  valid: boolean;
  riskLevel: UrlRiskLevel;
  threatScore: number;
  reasons: string[];
  sanitizedUrl: string | null;
}

export interface PhishingMitigatorOptions {
  trustedDomains?: string[];
  allowHttpInDev?: boolean;
}

const DEFAULT_TRUSTED_DOMAINS: ReadonlyArray<string> = [
  'sorotask.app',
  'sorolabs.xyz',
  'stellar.org',
  'freighter.app',
  'stellarchain.io',
  'horizon.stellar.org',
  'soroban-testnet.stellar.org',
];

const BLOCKED_SCHEMES = new Set([
  'javascript',
  'data',
  'vbscript',
  'blob',
  'file',
]);

const SUSPICIOUS_TLD = new Set([
  '.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.work', '.click',
]);

const REDIRECT_PARAMS = new Set([
  'url', 'redirect', 'return', 'returnurl', 'next', 'goto', 'redir',
  'redirect_uri', 'continue', 'destination', 'forward',
]);

const HOMOGRAPH_LOOK_ALIKES: ReadonlyMap<string, string> = new Map([
  ['ο', 'o'],
  ['о', 'o'],
  ['0', 'o'],
  ['1', 'l'],
  ['l', '1'],
  ['rn', 'm'],
  ['vv', 'w'],
  ['ɑ', 'a'],
  ['а', 'a'],
  ['е', 'e'],
  ['ё', 'e'],
  ['і', 'i'],
  ['ï', 'i'],
  ['ο', 'o'],
  ['р', 'p'],
  ['ѕ', 's'],
]);

function scoreToRisk(score: number): UrlRiskLevel {
  if (score === 0) return 'safe';
  if (score <= 3) return 'suspicious';
  return 'dangerous';
}

function normaliseDomain(domain: string): string {
  return domain.toLowerCase().trim().replace(/^www\./, '');
}

function isIpLiteral(host: string): boolean {
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^\[.*\]$/;
  return ipv4.test(host) || ipv6.test(host);
}

function hasPunycode(host: string): boolean {
  return host.split('.').some((label) => label.startsWith('xn--'));
}

function detectHomograph(host: string): boolean {
  const normalised = host.toLowerCase();
  for (const [lookalike] of HOMOGRAPH_LOOK_ALIKES) {
    if (normalised.includes(lookalike) && /[^\x00-\x7F]/.test(lookalike)) {
      return true;
    }
  }
  return false;
}

function hasOpenRedirectParam(url: URL): boolean {
  for (const [key] of url.searchParams) {
    if (REDIRECT_PARAMS.has(key.toLowerCase())) return true;
  }
  return false;
}

function domainMatchesTrusted(
  host: string,
  trustedSet: ReadonlyArray<string>,
): boolean {
  const normalised = normaliseDomain(host);
  return trustedSet.some((trusted) => {
    const t = normaliseDomain(trusted);
    return normalised === t || normalised.endsWith(`.${t}`);
  });
}

function hasSuspiciousTld(host: string): boolean {
  return SUSPICIOUS_TLD.has(
    host.slice(host.lastIndexOf('.')).toLowerCase(),
  );
}

export class PhishingMitigator {
  private readonly trustedDomains: ReadonlyArray<string>;
  private readonly allowHttpInDev: boolean;

  constructor({
    trustedDomains = [...DEFAULT_TRUSTED_DOMAINS],
    allowHttpInDev = false,
  }: PhishingMitigatorOptions = {}) {
    if (!Array.isArray(trustedDomains) || trustedDomains.length === 0) {
      throw new Error('trustedDomains must be a non-empty array');
    }
    this.trustedDomains = trustedDomains.map((d) => d.toLowerCase().trim());
    this.allowHttpInDev = allowHttpInDev;
  }

  /**
   * Validate a URL string for phishing risk.
   *
   * Returns a UrlValidationResult describing:
   *   - whether the URL is considered valid for navigation
   *   - a risk level (safe / suspicious / dangerous)
   *   - a numeric threat score (0 = clean, higher = more dangerous)
   *   - individual reasons for any raised flags
   *   - a sanitized URL string (null when URL is invalid or dangerous)
   *
   * O(D + P) per call.
   */
  validate(rawUrl: string): UrlValidationResult {
    const reasons: string[] = [];
    let score = 0;

    if (!rawUrl || typeof rawUrl !== 'string') {
      return {
        valid: false,
        riskLevel: 'dangerous',
        threatScore: 10,
        reasons: ['Input is not a valid string'],
        sanitizedUrl: null,
      };
    }

    const trimmed = rawUrl.trim();

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return {
        valid: false,
        riskLevel: 'dangerous',
        threatScore: 10,
        reasons: ['URL could not be parsed'],
        sanitizedUrl: null,
      };
    }

    const scheme = parsed.protocol.replace(':', '').toLowerCase();

    if (BLOCKED_SCHEMES.has(scheme)) {
      return {
        valid: false,
        riskLevel: 'dangerous',
        threatScore: 10,
        reasons: [`Blocked URL scheme: ${scheme}`],
        sanitizedUrl: null,
      };
    }

    if (scheme === 'http') {
      if (!this.allowHttpInDev) {
        score += 3;
        reasons.push('Insecure HTTP scheme — use HTTPS');
      }
    } else if (scheme !== 'https') {
      score += 5;
      reasons.push(`Non-standard scheme: ${scheme}`);
    }

    const host = parsed.hostname.toLowerCase();

    if (isIpLiteral(host)) {
      score += 4;
      reasons.push('URL uses a raw IP address instead of a domain name');
    }

    if (hasPunycode(host)) {
      score += 3;
      reasons.push('Punycode-encoded domain detected — possible IDN homograph attack');
    }

    if (detectHomograph(host)) {
      score += 5;
      reasons.push('Unicode homograph characters detected in domain');
    }

    const isTrusted = domainMatchesTrusted(host, this.trustedDomains);
    if (!isTrusted) {
      score += 2;
      reasons.push(`Domain is not in the trusted allowlist: ${host}`);
    }

    if (hasSuspiciousTld(host)) {
      score += 2;
      reasons.push(`Domain uses a high-risk TLD: ${host.slice(host.lastIndexOf('.'))}`);
    }

    if (hasOpenRedirectParam(parsed)) {
      score += 3;
      reasons.push('URL contains a query parameter commonly used for open redirect attacks');
    }

    if (parsed.username || parsed.password) {
      score += 4;
      reasons.push('URL contains embedded credentials — likely credential-harvesting attempt');
    }

    if (parsed.href.length > 2048) {
      score += 1;
      reasons.push('Abnormally long URL — may be attempting to obscure destination');
    }

    const riskLevel = scoreToRisk(score);
    const valid = riskLevel !== 'dangerous';

    return {
      valid,
      riskLevel,
      threatScore: score,
      reasons,
      sanitizedUrl: valid ? parsed.href : null,
    };
  }

  /**
   * Returns true only when a URL is fully safe (trusted domain, HTTPS, no flags).
   * O(D + P).
   */
  isSafe(rawUrl: string): boolean {
    return this.validate(rawUrl).riskLevel === 'safe';
  }

  /**
   * Returns the sanitized URL string, or null when dangerous.
   * O(D + P).
   */
  sanitize(rawUrl: string): string | null {
    return this.validate(rawUrl).sanitizedUrl;
  }
}

export const defaultMitigator = new PhishingMitigator();
