import 'package:flutter_test/flutter_test.dart';
import 'package:euro_cars/main.dart';

void main() {
  testWidgets('EURO CARS shows the welcome screen', (tester) async {
    await tester.pumpWidget(const EuroApp());
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('EURO CARS'), findsOneWidget);
    expect(find.text('أهلاً بك في EURO'), findsOneWidget);
  });
}
