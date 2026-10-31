import 'package:flutter_test/flutter_test.dart';
import 'package:euro_cars/main.dart';

void main() {
  testWidgets('EURO CARS shows startup loading state', (tester) async {
    await tester.pumpWidget(const EuroApp());
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
