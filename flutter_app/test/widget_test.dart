import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:euro_cars/auth_screens.dart';

void main() {
  testWidgets('EURO CARS shows the welcome screen', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: EuroAuthScreen(
          onLogin: (token, user) async {},
        ),
      ),
    );

    expect(find.text('EURO CARS'), findsOneWidget);
    expect(find.text('أهلاً بك في EURO'), findsOneWidget);
    expect(find.text('تسجيل الدخول'), findsOneWidget);
    expect(find.text('إنشاء حساب جديد'), findsOneWidget);
    expect(find.text('المتابعة كزائر'), findsOneWidget);
  });
}
