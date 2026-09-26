import SwiftUI

/// Row thumbnail. Embedded jpeg from the reader, a fixture path resolved on the
/// server, a proxied Google thumb, or a shop CDN. Grey placeholder otherwise.
struct ListingPhoto: View {
    let item: ShortlistItem
    var size: CGFloat = 88
    var dim = false

    var body: some View {
        content
            .frame(width: size, height: size)
            .background(Theme.panelRaised)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.line, lineWidth: 1))
            .opacity(dim ? 0.4 : 1)
    }

    @ViewBuilder
    private var content: some View {
        switch CoveredAPI.shared.photoSource(for: item) {
        case .data(let data):
            if let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                placeholder
            }
        case .remote(let url):
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                case .failure:
                    placeholder
                case .empty:
                    Color.clear
                @unknown default:
                    placeholder
                }
            }
        case .none:
            placeholder
        }
    }

    private var placeholder: some View {
        Text("NO PHOTO")
            .font(.system(size: 9, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(Theme.muted)
    }
}
