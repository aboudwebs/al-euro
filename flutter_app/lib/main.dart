import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';

const apiBase = String.fromEnvironment('EURO_API_URL', defaultValue: 'https://control-panel-euro-cars.onrender.com');
const bg = Color(0xFF07090E);
const panel = Color(0xFF11151E);
const border = Color(0xFF293141);
const blue = Color(0xFF0A84FF);
const red = Color(0xFF8D2637);
const muted = Color(0xFF9AA6B7);
const secure = FlutterSecureStorage();

void main() => runApp(const EuroApp());

class EuroApp extends StatelessWidget {
  const EuroApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'EURO CARS',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          brightness: Brightness.dark,
          scaffoldBackgroundColor: bg,
          colorScheme: const ColorScheme.dark(primary: blue, surface: panel),
          useMaterial3: true,
          inputDecorationTheme: InputDecorationTheme(
            filled: true,
            fillColor: panel,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: border),
            ),
          ),
        ),
        home: const Gate(),
      );
}

class Gate extends StatefulWidget {
  const Gate({super.key});
  @override
  State<Gate> createState() => _GateState();
}

class _GateState extends State<Gate> {
  String? token;
  Map<String, dynamic>? user;
  bool loading = true;

  @override
  void initState() {
    super.initState();
    restore();
  }

  Future<void> restore() async {
    final t = await secure.read(key: 'token');
    final u = await secure.read(key: 'user');
    if (t != null && u != null) {
      try {
        token = t;
        user = Map<String, dynamic>.from(jsonDecode(u));
      } catch (_) {
        await secure.deleteAll();
      }
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> login(String value, Map<String, dynamic> account) async {
    await secure.write(key: 'token', value: value);
    await secure.write(key: 'user', value: jsonEncode(account));
    if (mounted) setState(() {
      token = value;
      user = account;
    });
  }

  Future<void> logout() async {
    await secure.deleteAll();
    if (mounted) setState(() {
      token = null;
      user = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (token == null || user == null) return Login(onLogin: login);
    return Shop(token: token!, user: user!, onLogout: logout);
  }
}

class Login extends StatefulWidget {
  final Future<void> Function(String, Map<String, dynamic>) onLogin;
  const Login({super.key, required this.onLogin});
  @override
  State<Login> createState() => _LoginState();
}

class _LoginState extends State<Login> {
  final phone = TextEditingController();
  final pass = TextEditingController();
  String role = 'workshop';
  bool busy = false;
  String? error;

  Future<void> submit() async {
    if (phone.text.trim().isEmpty || pass.text.isEmpty) {
      setState(() => error = 'أدخل رقم الموبايل وكلمة المرور');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final response = await http
          .post(
            Uri.parse('$apiBase/api/auth'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'mode': 'login',
              'client': 'mobile',
              'role': role,
              'phone': phone.text.trim(),
              'password': pass.text,
            }),
          )
          .timeout(const Duration(seconds: 30));
      final data = Map<String, dynamic>.from(jsonDecode(response.body));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(data['error'] ?? 'تعذر تسجيل الدخول');
      }
      if (data['accessToken'] == null || data['user'] == null) {
        throw Exception('الخادم لم يرجع جلسة تطبيق صالحة');
      }
      await widget.onLogin(
        data['accessToken'].toString(),
        Map<String, dynamic>.from(data['user']),
      );
    } catch (e) {
      if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    phone.dispose();
    pass.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          body: SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 440),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Icon(Icons.directions_car_filled_rounded, color: red, size: 60),
                      const SizedBox(height: 12),
                      const Center(child: Text('EURO CARS', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, letterSpacing: 2))),
                      const SizedBox(height: 6),
                      const Center(child: Text('منصة قطع الصيانة للورشات', style: TextStyle(color: muted))),
                      const SizedBox(height: 32),
                      SegmentedButton<String>(
                        segments: const [
                          ButtonSegment(value: 'workshop', label: Text('حساب ورشة')),
                          ButtonSegment(value: 'marketer', label: Text('حساب مسوّق')),
                        ],
                        selected: {role},
                        onSelectionChanged: (value) => setState(() => role = value.first),
                      ),
                      const SizedBox(height: 16),
                      TextField(
                        controller: phone,
                        keyboardType: TextInputType.phone,
                        decoration: const InputDecoration(labelText: 'رقم الموبايل', prefixIcon: Icon(Icons.phone)),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: pass,
                        obscureText: true,
                        onSubmitted: (_) => submit(),
                        decoration: const InputDecoration(labelText: 'كلمة المرور', prefixIcon: Icon(Icons.lock_outline)),
                      ),
                      if (error != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Text(error!, style: const TextStyle(color: Colors.redAccent)),
                        ),
                      const SizedBox(height: 18),
                      FilledButton(
                        onPressed: busy ? null : submit,
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Text(busy ? 'جاري الدخول...' : 'تسجيل الدخول'),
                        ),
                      ),
                      const SizedBox(height: 12),
                      const Text(
                        'يلزم حساب مسجّل ومفعّل من إدارة EURO CARS.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: muted, fontSize: 12),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
}

class Shop extends StatefulWidget {
  final String token;
  final Map<String, dynamic> user;
  final Future<void> Function() onLogout;
  const Shop({super.key, required this.token, required this.user, required this.onLogout});
  @override
  State<Shop> createState() => _ShopState();
}

class _ShopState extends State<Shop> {
  int tab = 0;
  bool busy = false;
  bool addingAddress = true;
  String search = '';
  String? error;
  String? selectedAddressId;
  String? receiptPath;
  String? pendingOrderFingerprint;
  String? pendingOrderKey;
  List<Map<String, dynamic>> parts = [];
  List<Map<String, dynamic>> orders = [];
  List<Map<String, dynamic>> addresses = [];
  Map<String, int> cart = {};
  Map<String, dynamic> account = {};
  final searchCtl = TextEditingController();
  final addressLabelCtl = TextEditingController(text: 'الورشة');
  final governorateCtl = TextEditingController();
  final areaCtl = TextEditingController();
  final streetCtl = TextEditingController();
  final addressDetailsCtl = TextEditingController();

  String uuidV4() {
    final random = math.Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes.map((v) => v.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  Future<Map<String, dynamic>> api(String path) async {
    final response = await http.get(
      Uri.parse('$apiBase$path'),
      headers: {'Authorization': 'Bearer ${widget.token}'},
    ).timeout(const Duration(seconds: 30));
    final data = Map<String, dynamic>.from(jsonDecode(response.body));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(data['error'] ?? 'تعذر تحميل البيانات');
    }
    return data;
  }

  Future<Map<String, dynamic>> postJson(
    String path,
    Map<String, dynamic> body, {
    String? idempotencyKey,
  }) async {
    final headers = <String, String>{
      'Authorization': 'Bearer ${widget.token}',
      'Content-Type': 'application/json',
    };
    if (idempotencyKey != null) headers['idempotency-key'] = idempotencyKey;
    final response = await http.post(
      Uri.parse('$apiBase$path'),
      headers: headers,
      body: jsonEncode(body),
    ).timeout(const Duration(seconds: 30));
    final data = Map<String, dynamic>.from(jsonDecode(response.body));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(data['error'] ?? 'تعذر حفظ البيانات');
    }
    return data;
  }

  Future<void> loadParts() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final data = await api('/api/parts');
      parts = List<Map<String, dynamic>>.from(data['parts'] ?? []);
    } catch (e) {
      error = e.toString().replaceFirst('Exception: ', '');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> loadAddresses() async {
    try {
      final data = await api('/api/account/addresses');
      final list = List<Map<String, dynamic>>.from(data['addresses'] ?? []);
      if (!mounted) return;
      Map<String, dynamic>? defaultAddress;
      for (final address in list) {
        if (address['isDefault'] == true) {
          defaultAddress = address;
          break;
        }
      }
      final selectionExists = list.any((a) => '${a['id']}' == selectedAddressId);
      setState(() {
        addresses = list;
        if (!selectionExists) {
          selectedAddressId = list.isEmpty ? null : '${(defaultAddress ?? list.first)['id']}';
        }
        addingAddress = list.isEmpty;
      });
    } catch (e) {
      if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', ''));
    }
  }

  Future<void> saveAddress() async {
    final noDetails = [
      governorateCtl.text,
      areaCtl.text,
      streetCtl.text,
      addressDetailsCtl.text,
    ].every((value) => value.trim().isEmpty);
    if (addressLabelCtl.text.trim().isEmpty || noDetails) {
      setState(() => error = 'أدخل اسم العنوان وتفصيلاً واحداً على الأقل');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final data = await postJson(
        '/api/account/addresses',
        {
          'label': addressLabelCtl.text.trim(),
          'governorate': governorateCtl.text.trim(),
          'area': areaCtl.text.trim(),
          'street': streetCtl.text.trim(),
          'details': addressDetailsCtl.text.trim(),
          'phone': '${widget.user['phone'] ?? ''}',
          'isDefault': addresses.isEmpty,
        },
        idempotencyKey: uuidV4(),
      );
      final address = Map<String, dynamic>.from(data['address']);
      setState(() {
        addresses = [...addresses, address];
        selectedAddressId = '${address['id']}';
        addingAddress = false;
      });
    } catch (e) {
      setState(() => error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> pickReceipt() async {
    try {
      final file = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        imageQuality: 80,
        maxWidth: 1600,
      );
      if (file == null) return;
      if (await file.length() > 5 * 1024 * 1024) {
        if (mounted) setState(() => error = 'حجم الإيصال أكبر من 5 ميغابايت، اختر صورة أصغر');
        return;
      }
      if (mounted) setState(() => receiptPath = file.path);
    } catch (e) {
      if (mounted) setState(() => error = 'تعذر اختيار صورة الإيصال: ${e.toString()}');
    }
  }

  Future<void> loadOrders() async {
    setState(() => busy = true);
    try {
      final data = await api('/api/orders');
      orders = List<Map<String, dynamic>>.from(data['orders'] ?? []);
    } catch (e) {
      error = e.toString().replaceFirst('Exception: ', '');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> loadAccount() async {
    setState(() => busy = true);
    try {
      account = await api(
        widget.user['role'] == 'marketer'
            ? '/api/marketer/dashboard'
            : '/api/workshop/dashboard',
      );
    } catch (e) {
      error = e.toString().replaceFirst('Exception: ', '');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> sendOrder(String pay) async {
    if (cart.isEmpty) {
      setState(() => error = 'السلة فارغة');
      return;
    }
    if (selectedAddressId == null || selectedAddressId!.isEmpty) {
      setState(() => error = 'أضف عنوان شحن واحفظه قبل تأكيد الطلب');
      return;
    }
    if (pay == 'sham' && (receiptPath == null || receiptPath!.isEmpty)) {
      setState(() => error = 'اختر صورة إيصال شام كاش أولاً');
      return;
    }

    final fingerprint = jsonEncode({
      'items': cart,
      'pay': pay,
      'addressId': selectedAddressId,
      'receipt': receiptPath,
      'invoiceCurrency': 'USD',
    });
    if (pendingOrderFingerprint != fingerprint) {
      pendingOrderFingerprint = fingerprint;
      pendingOrderKey = uuidV4();
    }

    setState(() {
      busy = true;
      error = null;
    });
    try {
      final request = http.MultipartRequest('POST', Uri.parse('$apiBase/api/orders'));
      request.headers['Authorization'] = 'Bearer ${widget.token}';
      request.headers['idempotency-key'] = pendingOrderKey!;
      request.fields['items'] = jsonEncode(cart);
      request.fields['pay'] = pay;
      request.fields['addressId'] = selectedAddressId!;
      request.fields['invoiceCurrency'] = 'USD';
      if (pay == 'sham') {
        request.files.add(await http.MultipartFile.fromPath('receipt', receiptPath!));
      }
      final streamed = await request.send().timeout(const Duration(seconds: 45));
      final raw = await streamed.stream.bytesToString();
      final data = Map<String, dynamic>.from(jsonDecode(raw));
      if (streamed.statusCode < 200 || streamed.statusCode >= 300) {
        throw Exception(data['error'] ?? 'تعذر إرسال الطلب');
      }
      cart = {};
      pendingOrderFingerprint = null;
      pendingOrderKey = null;
      receiptPath = null;
      error = 'تم إرسال الطلب بنجاح: ${data['orderNumber'] ?? data['orderId'] ?? ''}';
      await loadOrders();
      if (mounted) setState(() => tab = 2);
    } catch (e) {
      error = e.toString().replaceFirst('Exception: ', '');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void initState() {
    super.initState();
    loadParts();
    loadAddresses();
  }

  @override
  void dispose() {
    searchCtl.dispose();
    addressLabelCtl.dispose();
    governorateCtl.dispose();
    areaCtl.dispose();
    streetCtl.dispose();
    addressDetailsCtl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final visible = parts.where((part) {
      final haystack = '${part['name']} ${part['brand']} ${part['pn']} ${part['model']}'.toLowerCase();
      return haystack.contains(search.toLowerCase());
    }).toList();
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          backgroundColor: bg,
          title: const Text('EURO CARS', style: TextStyle(fontWeight: FontWeight.w900)),
          actions: [IconButton(onPressed: widget.onLogout, icon: const Icon(Icons.logout))],
        ),
        bottomNavigationBar: NavigationBar(
          backgroundColor: panel,
          selectedIndex: tab,
          onDestinationSelected: (index) {
            setState(() => tab = index);
            if (index == 2) loadOrders();
            if (index == 3) loadAccount();
          },
          destinations: const [
            NavigationDestination(icon: Icon(Icons.grid_view), label: 'الكتالوج'),
            NavigationDestination(icon: Icon(Icons.shopping_bag_outlined), label: 'السلة'),
            NavigationDestination(icon: Icon(Icons.receipt_long), label: 'طلباتي'),
            NavigationDestination(icon: Icon(Icons.person_outline), label: 'حسابي'),
          ],
        ),
        body: Column(
          children: [
            if (busy) const LinearProgressIndicator(),
            if (error != null)
              Material(
                color: red.withValues(alpha: .25),
                child: ListTile(
                  title: Text(error!),
                  trailing: IconButton(
                    onPressed: () => setState(() => error = null),
                    icon: const Icon(Icons.close),
                  ),
                ),
              ),
            Expanded(
              child: IndexedStack(
                index: tab,
                children: [
                  catalog(visible),
                  cartPage(),
                  ordersPage(),
                  accountPage(),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget catalog(List<Map<String, dynamic>> list) => RefreshIndicator(
        onRefresh: loadParts,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextField(
              controller: searchCtl,
              onChanged: (value) => setState(() => search = value),
              decoration: const InputDecoration(
                hintText: 'بحث باسم القطعة أو الماركة أو رقم OEM',
                prefixIcon: Icon(Icons.search),
              ),
            ),
            const SizedBox(height: 12),
            if (list.isEmpty)
              const Padding(
                padding: EdgeInsets.all(30),
                child: Text('لا توجد قطع مطابقة حالياً', style: TextStyle(color: muted)),
              ),
            ...list.map((part) {
              final id = '${part['id']}';
              final quantity = cart[id] ?? 0;
              final stock = int.tryParse('${part['stock']}') ?? 0;
              return Card(
                color: panel,
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${part['name'] ?? 'قطعة'}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      const SizedBox(height: 5),
                      Text('${part['brand'] ?? ''} · OEM ${part['pn'] ?? '—'}', style: const TextStyle(color: muted)),
                      const SizedBox(height: 8),
                      Text('${part['price'] ?? 0} $ · المتوفر ${part['stock'] ?? 0}', style: const TextStyle(color: blue, fontWeight: FontWeight.bold)),
                      Row(
                        children: [
                          IconButton(
                            onPressed: quantity == 0 ? null : () => setState(() => cart[id] = quantity - 1),
                            icon: const Icon(Icons.remove_circle_outline),
                          ),
                          Text('$quantity'),
                          IconButton(
                            onPressed: quantity >= stock ? null : () => setState(() => cart[id] = quantity + 1),
                            icon: const Icon(Icons.add_circle_outline, color: blue),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            }),
          ],
        ),
      );

  Widget cartPage() {
    final selected = parts.where((part) => (cart['${part['id']}'] ?? 0) > 0).toList();
    final total = selected.fold<double>(
      0,
      (sum, part) => sum + (double.tryParse('${part['price']}') ?? 0) * (cart['${part['id']}'] ?? 0),
    );
    final marketer = widget.user['role'] == 'marketer';

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text('سلة الطلب', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
        ...selected.map((part) => ListTile(
              title: Text('${part['name']} × ${cart['${part['id']}']}'),
              subtitle: Text('${part['price']} $'),
            )),
        ListTile(
          title: const Text('الإجمالي'),
          trailing: Text('${total.toStringAsFixed(2)} $', style: const TextStyle(color: blue)),
        ),
        if (selected.isEmpty)
          const Text('أضف القطع من الكتالوج أولاً', style: TextStyle(color: muted)),
        const SizedBox(height: 14),
        const Text('عنوان الشحن', style: TextStyle(fontWeight: FontWeight.bold)),
        if (addresses.isNotEmpty && !addingAddress)
          DropdownButtonFormField<String>(
            value: selectedAddressId,
            decoration: const InputDecoration(labelText: 'اختر عنوان التوصيل'),
            items: addresses.map((address) {
              final parts = [address['governorate'], address['area'], address['street']]
                  .where((value) => value != null && '$value'.trim().isNotEmpty)
                  .join('، ');
              return DropdownMenuItem<String>(
                value: '${address['id']}',
                child: Text('${address['label']} · $parts', overflow: TextOverflow.ellipsis),
              );
            }).toList(),
            onChanged: (value) => setState(() => selectedAddressId = value),
          ),
        if (addresses.isEmpty || addingAddress) ...[
          TextField(controller: addressLabelCtl, decoration: const InputDecoration(labelText: 'اسم العنوان (مثال: الورشة)')),
          const SizedBox(height: 8),
          TextField(controller: governorateCtl, decoration: const InputDecoration(labelText: 'المحافظة')),
          const SizedBox(height: 8),
          TextField(controller: areaCtl, decoration: const InputDecoration(labelText: 'المنطقة')),
          const SizedBox(height: 8),
          TextField(controller: streetCtl, decoration: const InputDecoration(labelText: 'الشارع')),
          const SizedBox(height: 8),
          TextField(controller: addressDetailsCtl, decoration: const InputDecoration(labelText: 'تفاصيل إضافية')),
          const SizedBox(height: 8),
          FilledButton(onPressed: busy ? null : saveAddress, child: const Text('حفظ عنوان الشحن')),
        ],
        if (addresses.isNotEmpty && !addingAddress)
          TextButton.icon(
            onPressed: () => setState(() => addingAddress = true),
            icon: const Icon(Icons.add_location_alt_outlined),
            label: const Text('إضافة عنوان جديد'),
          ),
        if (!marketer) ...[
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: busy ? null : pickReceipt,
            icon: const Icon(Icons.receipt_long),
            label: Text(receiptPath == null ? 'اختيار صورة إيصال شام كاش' : 'تم اختيار صورة الإيصال · تغيير الصورة'),
          ),
          if (receiptPath != null)
            const Text('سيتم إرفاق الإيصال عند اختيار شام كاش فقط.', style: TextStyle(color: muted, fontSize: 12)),
        ],
        const SizedBox(height: 12),
        FilledButton(
          onPressed: busy || selected.isEmpty || selectedAddressId == null ? null : () => sendOrder('cod'),
          child: const Text('الدفع عند الاستلام'),
        ),
        if (!marketer)
          OutlinedButton(
            onPressed: busy || selected.isEmpty || selectedAddressId == null ? null : () => sendOrder('sham'),
            child: const Text('شام كاش'),
          ),
        if (!marketer)
          OutlinedButton(
            onPressed: busy || selected.isEmpty || selectedAddressId == null ? null : () => sendOrder('debt'),
            child: const Text('دفتر الدين للورشة'),
          ),
      ],
    );
  }

  Widget ordersPage() => RefreshIndicator(
        onRefresh: loadOrders,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text('طلباتي', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
            if (orders.isEmpty)
              const Text('لا توجد طلبات لعرضها', style: TextStyle(color: muted)),
            ...orders.map((order) => Card(
                  color: panel,
                  child: ListTile(
                    leading: const Icon(Icons.receipt_long, color: blue),
                    title: Text('طلب #${order['order_number'] ?? order['id'] ?? '—'}'),
                    subtitle: Text('${order['status'] ?? '—'}'),
                    trailing: Text('${order['total_amount'] ?? ''} $'),
                  ),
                )),
          ],
        ),
      );

  Widget accountPage() {
    final workshop = Map<String, dynamic>.from(account['user'] ?? {});
    final isMarketer = widget.user['role'] == 'marketer';
    final cashbackRate = (double.tryParse('${workshop['cashback_rate'] ?? 0}') ?? 0) * 100;
    return RefreshIndicator(
      onRefresh: loadAccount,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('أهلاً ${widget.user['name'] ?? ''}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
          Text('${widget.user['phone'] ?? ''}', style: const TextStyle(color: muted)),
          const SizedBox(height: 18),
          if (isMarketer) ...[
            _metric('كود الإحالة', '${widget.user['my_ref_code'] ?? '—'}'),
            _metric('العمولات المتاحة', '${account['commissions']?['available'] ?? 0} $'),
            _metric('العمولات المعلّقة', '${account['commissions']?['held'] ?? 0} $'),
          ] else ...[
            _metric('التصنيف', '${workshop['tier'] ?? widget.user['tier'] ?? 'Standard'}'),
            _metric('نسبة الكاش باك الحالية', '${cashbackRate.toStringAsFixed(0)}%'),
            _metric('رصيد الكاش باك', '${workshop['cashback_balance'] ?? 0} $'),
            _metric('حد الدين', '${workshop['debt_limit'] ?? widget.user['debt_limit'] ?? 0} $'),
            _metric('الرصيد المستحق', '${workshop['debt_balance'] ?? widget.user['debt_balance'] ?? 0} $'),
          ],
          OutlinedButton.icon(onPressed: loadAccount, icon: const Icon(Icons.refresh), label: const Text('تحديث بيانات الحساب')),
          OutlinedButton.icon(onPressed: widget.onLogout, icon: const Icon(Icons.logout), label: const Text('تسجيل الخروج')),
        ],
      ),
    );
  }

  Widget _metric(String label, String value) => Card(
        color: panel,
        child: ListTile(
          title: Text(label, style: const TextStyle(color: muted)),
          trailing: Text(value, style: const TextStyle(color: blue, fontWeight: FontWeight.bold)),
        ),
      );
}
