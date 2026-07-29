import { Inject, Injectable } from '@nestjs/common';

import { LegalService } from '../../legal/application/legal.service';
import { LegalRepository } from '../../legal/infrastructure/postgres/legal.repository';
import type { VerifiedOtp } from '../../otp/application/otp.service';
import {
  SessionsService,
  type SessionCredentials,
} from '../../sessions/application/sessions.service';
import { UsersRepository } from '../../users/infrastructure/postgres/users.repository';
import { RegistrationAuthorizationStore } from '../infrastructure/redis/registration-authorization.store';
import { DependencyUnavailableError } from './auth-application.error';

export type PostOtpResult =
  | {
      nextStep: 'authenticated';
      session: SessionCredentials;
    }
  | {
      nextStep: 'completeRegistration' | 'acceptLegal';
      registrationAuthorization: string;
      expiresAt: string;
    };

@Injectable()
export class AuthService {
  constructor(
    @Inject(UsersRepository) private readonly users: UsersRepository,
    @Inject(LegalService) private readonly legal: LegalService,
    @Inject(LegalRepository) private readonly legalRepository: LegalRepository,
    @Inject(RegistrationAuthorizationStore)
    private readonly registrations: RegistrationAuthorizationStore,
    @Inject(SessionsService) private readonly sessions: SessionsService,
  ) {}

  async routeVerifiedOtp(verified: VerifiedOtp): Promise<PostOtpResult> {
    try {
      return await this.routeVerifiedOtpWithDependencies(verified);
    } catch (error) {
      if (error instanceof DependencyUnavailableError) throw error;
      throw new DependencyUnavailableError({ cause: error });
    }
  }

  private async routeVerifiedOtpWithDependencies(
    verified: VerifiedOtp,
  ): Promise<PostOtpResult> {
    const user = await this.users.findByPhone(verified.phoneE164);
    let nextStep: PostOtpResult['nextStep'] = 'completeRegistration';

    if (user) {
      const [current, acceptedIds] = await Promise.all([
        this.legal.currentMandatory('fr-SN'),
        this.legalRepository.acceptedDocumentIds(user.id),
      ]);
      const accepted = new Set(acceptedIds);
      if (current.documents.every(({ id }) => accepted.has(id))) {
        return {
          nextStep: 'authenticated',
          session: await this.sessions.issueForUser({
            userId: user.id,
            installationId: verified.installationId,
            creationContext: `otp:${verified.challengeId}:${user.id}`,
          }),
        };
      }
      nextStep = 'acceptLegal';
    }

    const authorization = await this.registrations.issue({
      challengeId: verified.challengeId,
      phoneE164: verified.phoneE164,
      phoneConfirmedAt: verified.verifiedAt,
      installationId: verified.installationId,
      ...(verified.pendingPromoCode
        ? { pendingPromoCode: verified.pendingPromoCode }
        : {}),
      ...(user ? { existingUserId: user.id } : {}),
    });
    return {
      nextStep,
      registrationAuthorization: authorization.token,
      expiresAt: authorization.expiresAt.toISOString(),
    };
  }
}
