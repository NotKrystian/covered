import SwiftUI
import UIKit

struct OfferPhoto: View {
    let item: ShortlistItem
    var size: CGFloat = 72

    var body: some View {
        Group {
            if let data = DataURLImage.decode(item.imageDataUrl), let image = UIImage(data: data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else if let url = remoteURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .empty:
                        Color.muted.opacity(0.18)
                    case .failure:
                        placeholder
                    @unknown default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.muted.opacity(0.18))
        )
    }

    private var remoteURL: URL? {
        if let imageUrl = item.imageUrl, let url = URL(string: imageUrl) { return url }
        if let first = item.imageUrls.first, let url = URL(string: first) { return url }
        return nil
    }

    private var placeholder: some View {
        Color.muted.opacity(0.18)
    }
}
