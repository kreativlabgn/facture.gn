import { JwtService } from "@nestjs/jwt";

export interface AuthTokenPayload {
  sub: string;
}

export interface AuthTokenService {
  sign(payload: AuthTokenPayload): Promise<string>;
  verify(token: string): Promise<AuthTokenPayload>;
}

// ADR-011 : JWT RS256 pour l'authentification (distinct de la signature Ed25519
// par requête, non couverte par ce sprint — voir plan auth-rbac, alternatives écartées).
// Clé privée/publique en PEM via variables d'environnement en dev.
// TODO(ADR-008) : migrer vers HashiCorp Vault Transit en production, sans changer
// cette interface ni ses appelants.
export class JwtAuthTokenService implements AuthTokenService {
  private readonly jwt: JwtService;

  constructor(privateKey: string, publicKey: string, options: { expiresIn?: string } = {}) {
    this.jwt = new JwtService({
      privateKey,
      publicKey,
      // expiresIn accepte tout format "vercel/ms" ("12h", "1ms", ...) ; le typage de
      // @nestjs/jwt exige le type interne StringValue du package transitif "ms", non
      // résolvable ici en import direct — cast local plutôt que dépendance ajoutée
      // uniquement pour un type.
      signOptions: { algorithm: "RS256", expiresIn: (options.expiresIn ?? "12h") as never },
    });
  }

  sign(payload: AuthTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload);
  }

  verify(token: string): Promise<AuthTokenPayload> {
    return this.jwt.verifyAsync<AuthTokenPayload>(token, { algorithms: ["RS256"] });
  }
}
