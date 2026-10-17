import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { validationError } from '../common/api-error.js';
import { isId, isObj } from '../common/validate.js';
import { doubleElim, singleElim } from './brackets.js';
import { roundRobin } from './round-robin.js';
import { swiss } from './swiss.js';

const LIMITS: Record<string, [number, number]> = { round_robin: [2, 40], swiss: [2, 64], single_elim: [2, 128], double_elim: [3, 128] };

// Spec 5.7: pure computation, nothing is stored.
@Controller('audit/v1')
export class FixturesController {
  @Post('fixtures')
  @HttpCode(200)
  generate(@Body() b: any) {
    if (!isObj(b)) throw validationError(['body']);
    const limits = LIMITS[b.format];
    if (!limits) throw validationError(['format']);
    const teams = b.teams;
    if (!Array.isArray(teams) || !teams.every(isId) || new Set(teams).size !== teams.length || teams.length < limits[0] || teams.length > limits[1])
      throw validationError(['teams']);
    const params = b.params ?? {};
    if (!isObj(params)) throw validationError(['params']);
    switch (b.format) {
      case 'round_robin': return roundRobin(teams, params);
      case 'swiss': return swiss(teams, params);
      case 'single_elim': return singleElim(teams, params);
      default: return doubleElim(teams, params);
    }
  }
}
