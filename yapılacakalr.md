# Yol Haritası
Proje'nin ilerleyiş şeması bu olacak

1. Treasury contratını bitir;
   
   - kasa görevi görecek bot bu kasadan parayı alıp abi ödemeleri için kullanacak
   - ayrıca arbitrage kazançlarını bu kasaya aktaracak
   - kasaya sadece owner ve bot erişebilecek ayrıca kasanın bakiyesini agent gözlemleyebilecek

2. Router contractı yaz;
   
    - içersinde swap yapacak fonksiyon
    - flashloan kullanacak bir fonksiyon
  
3. Agenti yazdır, botu yazdır



# Teknik Plan
Contratları nasıl yazacağıma dair fikirler ve konuyla ilgili kaynaklar;

```
Bakman gereken kaynaklar;
MCP
A2A
x402 (zaten plan dahilinde)
ERC-8004
ERC-4626
Celo protocol
```

1. İlk olarak kasayı yazmam gerekiyor kasanın tek kullanıcısı bot olacak ancak owner olarak msg.sender belirlenecek böylelikle çekim işlemleri msg.sender tarafından kullanılacak
2. router contractı içerisinde şimdilik sushi swap ve uniswap router addresleri olmalı ki contract bakiye kullanma onayını versin router contractı başarılı gerçekleşen işlemlerden sonra eline geçen karı kasaya aktarmalı ve tabiki fonksiyonları sadece agent(bot) ve msg.sender kullanabilmeli 