import { ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { PASSWORD_SERVICE, AUTH_TOKEN_SERVICE } from "./auth.tokens";
import type { PasswordService } from "./password.service";
import type { AuthTokenService } from "./auth-token.service";
import type { RegisterDto } from "./dto/register.dto";
import type { LoginDto } from "./dto/login.dto";

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(PASSWORD_SERVICE) private readonly passwordService: PasswordService,
    @Inject(AUTH_TOKEN_SERVICE) private readonly tokenService: AuthTokenService,
  ) {}

  async register(dto: RegisterDto): Promise<{ userId: string }> {
    const existingPhone = await this.prisma.userPhone.findUnique({ where: { msisdn: dto.msisdn } });
    if (existingPhone) {
      throw new ConflictException(`Un compte existe déjà pour le numéro ${dto.msisdn}`);
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { name: dto.name, passwordHash } });
      await tx.userPhone.create({ data: { userId: created.id, msisdn: dto.msisdn, isPrimary: true } });
      return created;
    });

    return { userId: user.id };
  }

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    const phone = await this.prisma.userPhone.findUnique({
      where: { msisdn: dto.msisdn },
      include: { user: true },
    });

    // Même message quelle que soit la cause (msisdn inconnu ou mot de passe erroné) —
    // anti-énumération d'utilisateurs, voir plan auth-rbac Risque 4.
    const valid = phone?.user.passwordHash
      ? await this.passwordService.verify(phone.user.passwordHash, dto.password)
      : false;

    if (!phone || !valid) {
      throw new UnauthorizedException("Identifiants invalides");
    }

    const accessToken = await this.tokenService.sign({ sub: phone.user.id });
    return { accessToken };
  }
}
