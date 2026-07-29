use chrono::{DateTime, Datelike, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;

use super::CloudStoreError;

pub fn natural_month_period_end(
    period_start: DateTime<Utc>,
    billing_timezone: &str,
    anchor_day: u32,
) -> Result<DateTime<Utc>, CloudStoreError> {
    if !(1..=31).contains(&anchor_day) {
        return Err(CloudStoreError::InvalidBillingAnchorDay(anchor_day));
    }
    let timezone = billing_timezone
        .parse::<Tz>()
        .map_err(|_| CloudStoreError::InvalidBillingTimezone(billing_timezone.to_owned()))?;
    let local_start = period_start.with_timezone(&timezone);
    let (year, month) = next_month(local_start.year(), local_start.month());
    let day = anchor_day.min(days_in_month(year, month));
    let date = NaiveDate::from_ymd_opt(year, month, day)
        .ok_or(CloudStoreError::InvalidPeriodDate { year, month, day })?;
    let local_target = date
        .and_hms_nano_opt(
            local_start.hour(),
            local_start.minute(),
            local_start.second(),
            local_start.nanosecond(),
        )
        .ok_or(CloudStoreError::InvalidPeriodTime)?;
    resolve_local_time(timezone, local_target).map(|value| value.with_timezone(&Utc))
}

pub fn prorated_money(
    monthly_amount_minor: u64,
    now: DateTime<Utc>,
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
) -> Result<u64, CloudStoreError> {
    prorated(monthly_amount_minor, now, period_start, period_end, true)
}

pub fn prorated_credits(
    monthly_credit_micros: u64,
    now: DateTime<Utc>,
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
) -> Result<u64, CloudStoreError> {
    prorated(monthly_credit_micros, now, period_start, period_end, false)
}

fn prorated(
    amount: u64,
    now: DateTime<Utc>,
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
    round_up: bool,
) -> Result<u64, CloudStoreError> {
    if period_end <= period_start || now < period_start || now >= period_end {
        return Err(CloudStoreError::InvalidProrationWindow);
    }
    let total = (period_end - period_start)
        .num_nanoseconds()
        .ok_or(CloudStoreError::ProrationOverflow)?;
    let remaining = (period_end - now)
        .num_nanoseconds()
        .ok_or(CloudStoreError::ProrationOverflow)?;
    let numerator = u128::from(amount)
        .checked_mul(u128::try_from(remaining).map_err(|_| CloudStoreError::ProrationOverflow)?)
        .ok_or(CloudStoreError::ProrationOverflow)?;
    let denominator = u128::try_from(total).map_err(|_| CloudStoreError::ProrationOverflow)?;
    let value = if round_up {
        numerator
            .checked_add(denominator.saturating_sub(1))
            .ok_or(CloudStoreError::ProrationOverflow)?
            / denominator
    } else {
        numerator / denominator
    };
    u64::try_from(value).map_err(|_| CloudStoreError::ProrationOverflow)
}

const fn next_month(year: i32, month: u32) -> (i32, u32) {
    if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    }
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = next_month(year, month);
    let first_next = NaiveDate::from_ymd_opt(next_year, next_month, 1)
        .expect("year and month derived from a valid date");
    first_next
        .pred_opt()
        .expect("valid month has a previous day")
        .day()
}

fn resolve_local_time(
    timezone: Tz,
    mut local: NaiveDateTime,
) -> Result<DateTime<Tz>, CloudStoreError> {
    for _ in 0..=180 {
        match timezone.from_local_datetime(&local) {
            LocalResult::Single(value) => return Ok(value),
            LocalResult::Ambiguous(first, _) => return Ok(first),
            LocalResult::None => {
                local = local
                    .checked_add_signed(chrono::Duration::minutes(1))
                    .ok_or(CloudStoreError::InvalidPeriodTime)?;
            }
        }
    }
    Err(CloudStoreError::InvalidPeriodTime)
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone as _, Utc};

    use super::*;

    #[test]
    fn natural_month_preserves_anchor_after_short_month() {
        let january = Utc.with_ymd_and_hms(2025, 1, 31, 8, 30, 0).unwrap();
        let february = natural_month_period_end(january, "Asia/Shanghai", 31).unwrap();
        let march = natural_month_period_end(february, "Asia/Shanghai", 31).unwrap();
        assert_eq!(
            february,
            Utc.with_ymd_and_hms(2025, 2, 28, 8, 30, 0).unwrap()
        );
        assert_eq!(march, Utc.with_ymd_and_hms(2025, 3, 31, 8, 30, 0).unwrap());
    }

    #[test]
    fn money_rounds_up_and_credits_round_down() {
        let start = Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap();
        let end = Utc.with_ymd_and_hms(2025, 1, 4, 0, 0, 0).unwrap();
        let now = Utc.with_ymd_and_hms(2025, 1, 3, 0, 0, 0).unwrap();
        assert_eq!(prorated_money(10, now, start, end).unwrap(), 4);
        assert_eq!(prorated_credits(10, now, start, end).unwrap(), 3);
    }
}
