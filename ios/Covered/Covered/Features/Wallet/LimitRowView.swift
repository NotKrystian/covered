import SwiftUI

struct LimitRowView: View {
    let limit: Limit

    private var chip: LimitStatusChip {
        LimitStatusChip.resolve(status: limit.status, lastResult: limit.lastResult)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(limit.query)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.inkSoft)
                Spacer(minLength: 8)
                LimitChipLabel(chip: chip)
            }
            Text("buy at or under \(formatGBP(limit.maxPricePence))")
                .font(.system(size: 13))
                .foregroundStyle(Color.secondary)
            Text(LimitStatusChip.lastCheckedLabel(limit.lastCheckedAt))
                .font(.system(size: 12))
                .foregroundStyle(Color.tertiary)
        }
        .padding(14.5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                .strokeBorder(Color.hairline, lineWidth: 1)
        )
    }
}

struct LimitChipLabel: View {
    let chip: LimitStatusChip

    var body: some View {
        Text(chip.rawValue)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(good ? Color.accentInk : Color.chipText)
            .padding(.horizontal, 9)
            .padding(.vertical, 6.5)
            .background((good ? Color.chipGood : Color.chipNeutral), in: Capsule())
    }

    private var good: Bool {
        switch chip {
        case .filled, .watching:
            return true
        case .paused, .walletShort:
            return false
        }
    }
}
