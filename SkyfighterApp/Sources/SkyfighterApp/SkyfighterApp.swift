import SwiftUI

/// Main container view for the SKYFIGHTER iOS Application.
public struct SkyfighterAppMain: View {
    public init() {}
    
    public var body: some View {
        RootTabView()
            .preferredColorScheme(.dark)
    }
}