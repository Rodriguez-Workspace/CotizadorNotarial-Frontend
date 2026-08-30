import { Injectable } from '@angular/core';
import { DataService } from './data.service';
import { ExchangeRateService } from './exchange-rate.service';

@Injectable({
  providedIn: 'root'
})
export class CacheService {
  constructor(
    private dataService: DataService,
    private exchangeRateService: ExchangeRateService
  ) {}

  clearAllCache(): void {
    this.dataService.clearCache();
    this.exchangeRateService.clearCache();
  }
}
