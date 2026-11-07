import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

const _apiBase = String.fromEnvironment(
  'EURO_API_URL',
  defaultValue: 'https://control-panel-euro-cars.onrender.com',
);
const _firebaseEnabled = bool.fromEnvironment('EURO_FIREBASE_ENABLED', defaultValue: false);
const _bg = Color(0xFF07090E);
const _panel = Color(0xFF11151E);
const _border = Color(0xFF293141);
const _blue = Color(0xFF0A84FF);
const _red = Color(0xFF8D2637);
const _muted = Color(0xFF9AA6B7);

class EuroAuthScreen extends StatefulWidget {
  final Future<void> Function(String, Map<String, dynamic>) onLogin;
  const EuroAuthScreen({super.key, required this.onLogin});

  @override
  State<EuroAuthScreen> createState() => _EuroAuthScreenState();
}

class _EuroAuthScreenState extends State<EuroAuthScreen> {
  String stage = 'welcome';
  String role = 'workshop';
  bool busy = false;
  bool manualVerification = false;
  bool registering = false;
  String? error;
  String? verificationId;
  final phone = TextEditingController();
  final password = TextEditingController();
  final phonePassword = TextEditingController();
  final email = TextEditingController();
  final name = TextEditingController();
  final license = TextEditingController();
  final city = TextEditingController();
  final spec = TextEditingController();
  final otp = TextEditingController();

  User? get currentFirebaseUser => _firebaseEnabled ? FirebaseAuth.instance.currentUser : null;

  void showError(Object value) {
    if (mounted) setState(() => error = value.toString().replaceFirst('Exception: ', ''));
  }

  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) async {
    final response = await http.post(
      Uri.parse('$_apiBase$path'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    ).timeout(const Duration(seconds: 40));
    final data = Map<String, dynamic>.from(jsonDecode(response.body));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(data['error'] ?? 'تعذر إكمال العملية');
    }
    return data;
  }

  Future<void> legacyLogin() async {
    if (phone.text.trim().isEmpty || phonePassword.text.isEmpty) {
      showError('أدخل رقم الموبايل وكلمة المرور');
      return;
    }
    setState(() { busy = true; error = null; });
    try {
      final data = await post('/api/auth', {
        'mode': 'login',
        'client': 'mobile',
        'phone': phone.text.trim(),
        'password': phonePassword.text,
      });
      if (data['accessToken'] == null || data['user'] == null) {
        throw Exception('الخادم لم يرجع جلسة تطبيق صالحة');
      }
      await widget.onLogin(
        data['accessToken'].toString(),
        Map<String, dynamic>.from(data['user']),
      );
    } catch (e) {
      showError(e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> emailLogin() async {
    if (!_firebaseEnabled) {
      showError('تسجيل الدخول بالبريد غير مفعّل بعد؛ يلزم إعداد Firebase أولاً.');
      return;
    }
    if (email.text.trim().isEmpty || password.text.isEmpty) {
      showError('أدخل البريد الإلكتروني وكلمة المرور');
      return;
    }
    setState(() { busy = true; error = null; registering = false; });
    try {
      final result = await FirebaseAuth.instance.signInWithEmailAndPassword(
        email: email.text.trim(),
        password: password.text,
      );
      await _continueFirebaseUser(result.user);
    } catch (e) {
      showError(e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> emailRegister() async {
    if (!_firebaseEnabled) {
      showError('إنشاء الحساب بالبريد غير مفعّل بعد؛ يلزم إعداد Firebase أولاً.');
      return;
    }
    if (email.text.trim().isEmpty || password.text.length < 6) {
      showError('أدخل بريداً صحيحاً وكلمة مرور من 6 أحرف على الأقل');
      return;
    }
    if (name.text.trim().length < 2) {
      showError('أدخل الاسم الكامل');
      return;
    }
    setState(() { busy = true; error = null; registering = true; });
    try {
      final result = await FirebaseAuth.instance.createUserWithEmailAndPassword(
        email: email.text.trim(),
        password: password.text,
      );
      await _startPhoneVerification(result.user);
    } catch (e) {
      showError(e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> socialLogin(String providerName) async {
    if (!_firebaseEnabled) {
      showError('تسجيل الدخول الاجتماعي غير مفعّل بعد؛ يلزم إعداد Firebase أولاً.');
      return;
    }
    setState(() { busy = true; error = null; registering = false; });
    try {
      final provider = OAuthProvider(providerName);
      if (providerName == 'apple.com') {
        provider.addScope('email');
        provider.addScope('name');
      } else {
        provider.addScope('email');
      }
      final result = await FirebaseAuth.instance.signInWithProvider(provider);
      await _continueFirebaseUser(result.user);
    } catch (e) {
      showError(e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _continueFirebaseUser(User? user) async {
    if (user == null) throw Exception('تعذر الحصول على حساب Firebase');
    if (user.phoneNumber == null || user.phoneNumber!.isEmpty) {
      await _startPhoneVerification(user);
      return;
    }
    await _exchangeFirebaseIdentity(user);
  }

  Future<void> _startPhoneVerification(User? user) async {
    if (user == null) throw Exception('سجّل الدخول أولاً');
    if (user.phoneNumber != null && user.phoneNumber!.isNotEmpty) {
      if (registering) {
        if (mounted) setState(() => stage = 'register');
      } else {
        await _exchangeFirebaseIdentity(user);
      }
      return;
    }
    final number = phone.text.trim();
    if (!RegExp(r'^\+[1-9][0-9]{7,14}$').hasMatch(number)) {
      if (mounted) setState(() { stage = 'phone'; error = 'أدخل رقم الهاتف بالصيغة الدولية، مثال: +963...'; });
      return;
    }
    await FirebaseAuth.instance.verifyPhoneNumber(
      phoneNumber: number,
      timeout: const Duration(seconds: 60),
      verificationCompleted: (credential) async {
        try {
          final current = currentFirebaseUser;
          if (current == null) return;
          await current.linkWithCredential(credential);
          final refreshed = currentFirebaseUser;
          if (registering) {
            if (mounted) setState(() => stage = 'register');
          } else {
            await _exchangeFirebaseIdentity(refreshed);
          }
        } catch (e) {
          showError(e);
        }
      },
      verificationFailed: (exception) => showError(exception.message ?? exception.code),
      codeSent: (id, _) {
        if (mounted) setState(() { verificationId = id; stage = 'phone'; error = null; });
      },
      codeAutoRetrievalTimeout: (id) {
        verificationId = id;
      },
    );
  }

  Future<void> verifyPhoneCode() async {
    if (verificationId == null || otp.text.trim().length != 6) {
      showError('أدخل رمز التحقق المكوّن من 6 أرقام');
      return;
    }
    setState(() { busy = true; error = null; });
    try {
      final credential = PhoneAuthProvider.credential(
        verificationId: verificationId!,
        smsCode: otp.text.trim(),
      );
      final current = currentFirebaseUser;
      if (current == null) throw Exception('انتهت جلسة التحقق، أعد المحاولة');
      await current.linkWithCredential(credential);
      final refreshed = currentFirebaseUser;
      if (registering) {
        if (mounted) setState(() => stage = 'register');
      } else {
        await _exchangeFirebaseIdentity(refreshed);
      }
    } catch (e) {
      showError(e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _exchangeFirebaseIdentity(User? user) async {
    if (user == null) throw Exception('جلسة Firebase غير موجودة');
    final token = await user.getIdToken(true);
    final data = await post('/api/auth/firebase', {'idToken': token});
    if (data['registrationRequired'] == true) {
      if (mounted) setState(() { stage = 'register'; error = null; });
      return;
    }
    if (data['pendingApproval'] == true) {
      await FirebaseAuth.instance.signOut();
      throw Exception(data['error'] ?? 'حسابك بانتظار موافقة الإدارة');
    }
    if (data['accessToken'] == null || data['user'] == null) {
      throw Exception('الخادم لم يرجع جلسة EURO صالحة');
    }
    await widget.onLogin(
      data['accessToken'].toString(),
      Map<String, dynamic>.from(data['user']),
    );
  }

  Future<void> completeRegistration() async {
    if (name.text.trim().length < 2) {
      showError('أدخل الاسم الكامل');
      return;
    }
    if (role == 'workshop' && ((!manualVerification && license.text.trim().isEmpty) || city.text.trim().isEmpty || spec.text.trim().isEmpty)) {
      showError('أدخل الترخيص أو اختر التحقق اليدوي، وحدد المدينة والاختصاص');
      return;
    }
    setState(() { busy = true; error = null; });
    try {
      final user = currentFirebaseUser;
      if (user == null || user.phoneNumber == null) {
        throw Exception('يجب توثيق رقم الهاتف أولاً');
      }
      final token = await user.getIdToken(true);
      final data = await post('/api/auth/firebase/register', {
        'idToken': token,
        'role': role,
        'name': name.text.trim(),
        'license': license.text.trim(),
        'manualVerification': manualVerification,
        'city': city.text.trim(),
        'spec': spec.text.trim(),
      });
      if (data['pendingApproval'] == true) {
        await FirebaseAuth.instance.signOut();
        if (mounted) setState(() { stage = 'welcome'; error = data['message'] ?? 'تم إرسال طلبك للإدارة للمراجعة.'; });
        return;
      }
      if (data['accessToken'] == null || data['user'] == null) {
        throw Exception('الخادم لم يرجع جلسة EURO صالحة');
      }
      await widget.onLogin(
        data['accessToken'].toString(),
        Map<String, dynamic>.from(data['user']),
      );
    } catch (e) {
      showError(e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    phone.dispose();
    password.dispose();
    phonePassword.dispose();
    email.dispose();
    name.dispose();
    license.dispose();
    city.dispose();
    spec.dispose();
    otp.dispose();
    super.dispose();
  }

  Widget field(TextEditingController controller, String label, {bool secret = false, TextInputType? keyboard}) {
    return TextField(
      controller: controller,
      obscureText: secret,
      keyboardType: keyboard,
      decoration: InputDecoration(labelText: label, prefixIcon: const Icon(Icons.circle_outlined, size: 16)),
    );
  }

  Widget actionButton(String label, VoidCallback? onPressed, {bool outlined = false}) {
    return outlined
        ? OutlinedButton(onPressed: busy ? null : onPressed, child: Padding(padding: const EdgeInsets.all(12), child: Text(label)))
        : FilledButton(onPressed: busy ? null : onPressed, child: Padding(padding: const EdgeInsets.all(12), child: Text(label)));
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(22),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const SizedBox(height: 24),
                    const Icon(Icons.directions_car_filled_rounded, color: _red, size: 58),
                    const SizedBox(height: 10),
                    const Center(child: Text('EURO CARS', style: TextStyle(fontSize: 29, fontWeight: FontWeight.w900, letterSpacing: 2))),
                    const SizedBox(height: 6),
                    const Center(child: Text('منصة قطع الصيانة للورشات', style: TextStyle(color: _muted))),
                    const SizedBox(height: 30),
                    if (stage == 'welcome') ...[
                      const Text('أهلاً بك في EURO', textAlign: TextAlign.center, style: TextStyle(fontSize: 23, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 8),
                      const Text('كل قطع الصيانة التي تحتاجها، في مكان واحد.', textAlign: TextAlign.center, style: TextStyle(color: _muted)),
                      const SizedBox(height: 26),
                      actionButton('تسجيل الدخول', () => setState(() { stage = 'login'; error = null; })),
                      const SizedBox(height: 10),
                      actionButton('إنشاء حساب جديد', () => setState(() { stage = 'register'; registering = true; error = null; }), outlined: true),
                      const SizedBox(height: 10),
                      TextButton.icon(onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const GuestCatalog())), icon: const Icon(Icons.visibility_outlined), label: const Text('المتابعة كزائر')),
                    ],
                    if (stage == 'login') ...[
                      const Text('تسجيل الدخول', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 16),
                      field(phone, 'رقم الموبايل', keyboard: TextInputType.phone),
                      const SizedBox(height: 10),
                      field(phonePassword, 'كلمة المرور', secret: true),
                      const SizedBox(height: 14),
                      actionButton('دخول برقم الهاتف', legacyLogin),
                      const Divider(height: 30),
                      field(email, 'البريد الإلكتروني', keyboard: TextInputType.emailAddress),
                      const SizedBox(height: 10),
                      field(password, 'كلمة المرور للبريد', secret: true),
                      const SizedBox(height: 12),
                      actionButton('الدخول بالبريد الإلكتروني', emailLogin, outlined: true),
                      const SizedBox(height: 10),
                      actionButton('المتابعة عبر Google', () => socialLogin('google.com'), outlined: true),
                      const SizedBox(height: 8),
                      actionButton('المتابعة عبر Apple', () => socialLogin('apple.com'), outlined: true),
                      TextButton(onPressed: () => setState(() { stage = 'welcome'; error = null; }), child: const Text('رجوع')),
                    ],
                    if (stage == 'phone') ...[
                      const Text('توثيق رقم الهاتف', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 8),
                      const Text('سنرسل رمز تحقق لمرة واحدة. بعد نجاح التوثيق لن تحتاج لإعادته عند كل تسجيل دخول.', style: TextStyle(color: _muted)),
                      const SizedBox(height: 16),
                      field(phone, 'رقم الهاتف بالصيغة الدولية (+963...)', keyboard: TextInputType.phone),
                      actionButton('إرسال رمز التحقق', () => _startPhoneVerification(currentFirebaseUser), outlined: true),
                      const SizedBox(height: 12),
                      field(otp, 'رمز SMS المكوّن من 6 أرقام', keyboard: TextInputType.number),
                      actionButton('تأكيد الرقم', verifyPhoneCode),
                    ],
                    if (stage == 'register') ...[
                      const Text('إنشاء حساب EURO', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 8),
                      const Text('اختر نوع الحساب، ثم أكمل بيانات التسجيل.', style: TextStyle(color: _muted)),
                      const SizedBox(height: 16),
                      if (currentFirebaseUser == null) ...[
                        field(email, 'البريد الإلكتروني', keyboard: TextInputType.emailAddress),
                        const SizedBox(height: 10),
                        field(password, 'كلمة المرور (6 أحرف على الأقل)', secret: true),
                        const SizedBox(height: 14),
                      ],
                      SegmentedButton<String>(
                        segments: const [
                          ButtonSegment(value: 'workshop', label: Text('ورشة')),
                          ButtonSegment(value: 'marketer', label: Text('مسوّق')),
                        ],
                        selected: {role},
                        onSelectionChanged: (values) => setState(() => role = values.first),
                      ),
                      const SizedBox(height: 12),
                      field(name, 'الاسم الكامل'),
                      if (role == 'workshop') ...[
                        const SizedBox(height: 10),
                        field(license, 'رقم الترخيص (اختياري عند التحقق اليدوي)'),
                        CheckboxListTile(
                          contentPadding: EdgeInsets.zero,
                          value: manualVerification,
                          onChanged: (value) => setState(() => manualVerification = value ?? false),
                          title: const Text('لا أملك وثيقة حالياً، أطلب التحقق اليدوي'),
                        ),
                        const SizedBox(height: 8),
                        field(city, 'المدينة'),
                        const SizedBox(height: 8),
                        field(spec, 'اختصاص الورشة'),
                      ],
                      const SizedBox(height: 16),
                      if (currentFirebaseUser == null) ...[
                        actionButton('متابعة عبر البريد والتحقق بالهاتف', emailRegister, outlined: true),
                        const SizedBox(height: 8),
                        actionButton('إنشاء عبر Google', () => socialLogin('google.com'), outlined: true),
                        const SizedBox(height: 8),
                        actionButton('إنشاء عبر Apple', () => socialLogin('apple.com'), outlined: true),
                      ],
                      if (currentFirebaseUser?.phoneNumber != null) ...[
                        const SizedBox(height: 14),
                        actionButton('تأكيد وإنشاء الحساب', completeRegistration),
                      ],
                      TextButton(onPressed: () => setState(() { stage = 'welcome'; error = null; }), child: const Text('رجوع')),
                    ],
                    if (error != null) ...[
                      const SizedBox(height: 14),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(color: _red.withValues(alpha: .18), borderRadius: BorderRadius.circular(12), border: Border.all(color: _border)),
                        child: Text(error!, style: const TextStyle(color: Colors.redAccent)),
                      ),
                    ],
                    if (busy) ...[
                      const SizedBox(height: 18),
                      const Center(child: CircularProgressIndicator()),
                    ],
                    if (!_firebaseEnabled && stage != 'welcome') ...[
                      const SizedBox(height: 12),
                      const Text('طرق البريد وGoogle وApple بانتظار إعداد Firebase للمشروع. تسجيل الدخول القديم برقم الهاتف يبقى متاحاً.', textAlign: TextAlign.center, style: TextStyle(color: _muted, fontSize: 12)),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class GuestCatalog extends StatefulWidget {
  const GuestCatalog({super.key});

  @override
  State<GuestCatalog> createState() => _GuestCatalogState();
}

class _GuestCatalogState extends State<GuestCatalog> {
  List<Map<String, dynamic>> parts = [];
  bool loading = true;
  String? error;
  String search = '';

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final response = await http.get(Uri.parse('$_apiBase/api/parts')).timeout(const Duration(seconds: 30));
      final data = Map<String, dynamic>.from(jsonDecode(response.body));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(data['error'] ?? 'تعذر تحميل الكتالوج');
      }
      parts = List<Map<String, dynamic>>.from(data['parts'] ?? []);
    } catch (e) {
      error = e.toString().replaceFirst('Exception: ', '');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final visible = parts.where((part) =>
      '${part['name']} ${part['brand']} ${part['pn']} ${part['model']}'.toLowerCase().contains(search.toLowerCase())
    ).toList();
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('تصفح الكتالوج كزائر')),
        body: loading
            ? const Center(child: CircularProgressIndicator())
            : error != null
                ? Center(child: Text(error!))
                : ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      TextField(
                        onChanged: (value) => setState(() => search = value),
                        decoration: const InputDecoration(hintText: 'ابحث باسم القطعة أو رقم OEM', prefixIcon: Icon(Icons.search)),
                      ),
                      const SizedBox(height: 12),
                      const Text('وضع الزائر للعرض فقط. تسجيل الدخول مطلوب للطلبات والخدمات الخاصة بالحساب.', style: TextStyle(color: _muted)),
                      const SizedBox(height: 10),
                      ...visible.map((part) => Card(
                        color: _panel,
                        child: ListTile(
                          title: Text('${part['name'] ?? 'قطعة'}'),
                          subtitle: Text('${part['brand'] ?? ''} · OEM ${part['pn'] ?? '—'}'),
                          trailing: Text('${part['price'] ?? 0} $'),
                        ),
                      )),
                    ],
                  ),
      ),
    );
  }
}
