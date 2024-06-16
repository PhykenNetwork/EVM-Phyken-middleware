import {
  Injectable,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHmac } from 'crypto';
import { Waitlist, WaitlistDocument } from './waitlist.schema';
import { WaitlistDto } from './dto/waitlist.dto';
import { MailService } from 'src/mail/mail.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WaitlistService {
  constructor(
    @InjectModel(Waitlist.name)
    private readonly waitlistModel: Model<WaitlistDocument>,
    private readonly mailService: MailService,
    private configService: ConfigService,
  ) {}

  async create(waitlistDto: WaitlistDto): Promise<Waitlist> {
    try {
      const timestamp = Date.now().toString();
      const hash = this.generateHash(waitlistDto.email, timestamp);

      const createdInvestment = new this.waitlistModel({
        ...waitlistDto,
        verificationHash: hash,
        timestamp: timestamp,
      });
      const savedWaitlist = await createdInvestment.save();

      await this.mailService.verifyWaitlistEmail({
        to: waitlistDto.email,
        firstName: waitlistDto.firstName,
        data: {
          hash: hash,
        },
      });

      return savedWaitlist;
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException('Email already exists');
      }
      console.error('Failed to create waitlist entry:', error);
      throw new InternalServerErrorException('Internal server error');
    }
  }

  private generateHash(email: string, timestamp: string): string {
    return createHmac(
      'sha256',
      this.configService.getOrThrow('HASH_SECRET_KEY'),
    )
      .update(email + timestamp)
      .digest('hex');
  }

  async verifyEmail(hash: string): Promise<boolean> {
    const waitlistEntry = await this.waitlistModel.findOne({
      verificationHash: hash,
    });
    if (!waitlistEntry) {
      return false;
    }

    const currentTimestamp = Date.now();
    const hashTimestamp = parseInt(waitlistEntry.timestamp, 10);

    if (currentTimestamp - hashTimestamp > 24 * 60 * 60 * 1000) {
      return false;
    }

    waitlistEntry.isVerified = true;
    await waitlistEntry.save();
    return true;
  }
}
