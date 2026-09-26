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
                    .font(.ui(16, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer(minLength: 8)
                LimitChipLabel(chip: chip)
            }
            Text("buy at or under \(formatGBP(limit.maxPricePence))")
                .font(.money(14))
                .foregroundStyle(Color.white.opacity(0.72))
            Text(LimitStatusChip.lastCheckedLabel(limit.lastCheckedAt))
                .font(.ui(12))
                .foregroundStyle(Color.white.opacity(0.5))
            if !limit.lastResult.isEmpty {
                Text(limit.lastResult)
                    .font(.ui(12))
                    .foregroundStyle(Color.white.opacity(0.45))
            }
        }
        .padding(Theme.pad)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.ink, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
    }
}

struct LimitChipLabel: View {
    let chip: LimitStatusChip

    var body: some View {
        Text(chip.rawValue)
            .font(.ui(11, weight: .semibold))
            .foregroundStyle(foreground)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(background, in: Capsule())
    }

    private var foreground: Color {
        switch chip {
        case .filled, .watching:
            return Color.ink
        case .paused, .walletShort:
            return .white
        }
    }

    private var background: Color {
        switch chip {
        case .watching:
            return Color.accent
        case .filled:
            return Color.accent
        case .paused:
            return Color.muted
        case .walletShort:
            return Color.dangerGrey
        }
    }
}

extension View {
    @ViewBuilder
    func coveredSwap() -> some View {
        if #available(iOS 18.0, *) {
            self.transition(.blurReplace)
        } else {
            self.transition(.opacity)
        }
    }
}
