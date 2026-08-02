import { AuthService } from '../src/auth/application/auth.service';
import { SessionsRepository } from '../src/sessions/infrastructure/postgres/sessions.repository';
import { OrangeSmsProvider } from '../src/sms/infrastructure/orange/orange-sms.provider';

async function persistAuditRecord(): Promise<void> {
    await Promise.resolve();
}

Promise.resolve();
[1].forEach(async () => persistAuditRecord());

console.log('controller diagnostic fixture');

void AuthService;
void OrangeSmsProvider;
void SessionsRepository;
