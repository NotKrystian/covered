import SwiftUI

/// The film's pay morph: a ring that closes while the wallet debits, then the
/// arc fades and a check draws. Springs only.
struct RingCheck: View {
    enum Phase: Equatable { case idle, paying, done, failed }

    let phase: Phase
    var size: CGFloat = 72

    @State private var ring: CGFloat = 0
    @State private var check: CGFloat = 0
    @State private var ringOpacity: Double = 1

    private var lineWidth: CGFloat { size * 0.075 }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Theme.line, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: ring)
                .stroke(phase == .failed ? Theme.danger : Theme.accent, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .opacity(ringOpacity)
            CheckShape()
                .trim(from: 0, to: check)
                .stroke(Theme.accent, style: StrokeStyle(lineWidth: lineWidth * 1.1, lineCap: .round, lineJoin: .round))
                .padding(size * 0.22)
        }
        .frame(width: size, height: size)
        .onAppear { apply(phase, animated: false) }
        .onChange(of: phase) { _, next in apply(next, animated: true) }
    }

    private func apply(_ next: Phase, animated: Bool) {
        switch next {
        case .idle:
            withAnimation(animated ? Motion.spring : nil) {
                ring = 0
                check = 0
                ringOpacity = 1
            }
        case .paying:
            check = 0
            ringOpacity = 1
            withAnimation(animated ? .easeOut(duration: 1.6) : nil) { ring = 0.85 }
        case .done:
            withAnimation(Motion.spring) { ring = 1 }
            withAnimation(Motion.spring.delay(0.18)) {
                ringOpacity = 0
                check = 1
            }
        case .failed:
            withAnimation(Motion.spring) {
                ring = 1
                check = 0
                ringOpacity = 1
            }
        }
    }
}

/// The film's check path: M40 66 L56 81 L89 47 in a 128 box.
struct CheckShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + rect.width * (x / 128), y: rect.minY + rect.height * (y / 128))
        }
        path.move(to: point(28, 66))
        path.addLine(to: point(52, 90))
        path.addLine(to: point(102, 40))
        return path
    }
}
