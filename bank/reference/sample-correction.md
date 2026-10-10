SCORE: 9/23

# CS Paper 2 — number systems, working compulsory

**Hand-in check.** The requirement was full working for **(a)–(h)**. Two photographs were handed in and they carry (a), (b), (c), (d), (e), (g), (h) with working. **(f) is not answered** — the page shows only the fragment `2 ?` under the label, no range and no bit pattern, so it scores zero. `submission.md` is empty, as stated; everything below is marked from the photographs.

One fault runs through (a), (e) and (h) and costs **6 marks on its own**: the **sign bit**. Every negative number you wrote came out with a leading $0$. A negative in two's complement *cannot* have MSB $= 0$ — that pattern is a positive number.

---

## (a) $-35$ in 8-bit two's complement — **2 / 3**

| Step | You wrote | Correct |
|---|---|---|
| Magnitude $35$ | $00100011_2$ | $00100011_2$ ✔ |
| Invert | $01011100_2$ | $11011100_2$ |
| $+1$ | $01011101_2$ | $11011101_2$ |

The magnitude is right and the $+1$ was applied correctly — that is the step you were losing in August and you have it now. The mark goes on the inversion:

$$00100011_2 \xrightarrow{\text{invert}} 11011100_2 \xrightarrow{+1} 11011101_2 = -35$$

Bit 7 of $00100011_2$ is $0$; inverted it must become $1$. You carried the $0$ straight through. Your final answer $01011101_2$ is $+93$, not $-35$.

## (b) $45 - 78$ in 8 bits — **1 / 5**

Two separate failures here, and the second is the one flagged on 12 Aug.

**1. You negated the wrong operand.** $45 - 78$ means $45 + (-78)$. You wrote *"2's compliment of 45"* and produced $11010011_2$, which is $-45$. The $45$ must stay **positive**:

$$45 = 00101101_2 \quad\text{(this line is your one mark — it is correct)}$$

**2. $-78$ was written in sign-magnitude, not two's complement.** You wrote $11001110_2$. That is $78 = 1001110_2$ with a sign bit stuck on the front. This is exactly the error the quest text named from 12 Aug: you complemented nothing, you just flagged the sign.

```
78            = 0 1 0 0 1 1 1 0
invert        = 1 0 1 1 0 0 0 1
+1            = 1 0 1 1 0 0 1 0   <- this is -78
```

The whole sum should read:

```
    0 0 1 0 1 1 0 1     (+45)
  + 1 0 1 1 0 0 1 0     (-78)
  -----------------
    1 1 0 1 1 1 1 1     = -33
```

$11011111_2$ is negative, and $-(00100000_2 + 1) = -33$. Correct answer: $-33$.

**Overflow.** You wrote *"overflow thrown away"* and *"overflow ignored"*. That is the **carry-out**, which is a different thing, and no rule was given, so no mark. The rule: **overflow occurred if the carry INTO the sign bit differs from the carry OUT of it** — equivalently, adding a positive and a negative can *never* overflow. Here there is no overflow. Your final $\underline{1011111}$ ($-95$) is wrong on both operands and on the conclusion.

## (c) $3CD_{16}$ to binary — **1 / 3**

| Hex digit | You wrote | Correct |
|---|---|---|
| $3$ | $0011$ | $0011$ ✔ |
| $C$ | $1011$ | $1100$ |
| $D$ | $1100$ | $1101$ |

Your nibbles are each **one digit too low**: $1011 = B$ and $1100 = C$. You have written $3BC_{16}$, not $3CD_{16}$. This is the hex slip logged on 12 Aug, unchanged. Fix it by counting from a fixed anchor, not by feel: $A=1010$, then add one each time — $B=1011$, $C=1100$, $D=1101$, $E=1110$, $F=1111$.

$$3CD_{16} = 0011\;1100\;1101_2$$

## (d) $6.75_{10}$ to fractional binary — **2 / 3**

The answer $110.11_2$ is **correct**, and both halves of the method are shown properly — repeated division for the integer part, repeated multiplication for the fraction:

$$0.75 \times 2 = 1.5 \rightarrow 1 \qquad 0.5 \times 2 = 1.0 \rightarrow 1$$

The lost mark is the one the question asked for by name: *"writing the place value above each bit"*. There are no place values on the page. On Paper 2 that is a stated requirement, so it is a stated mark:

| $4$ | $2$ | $1$ | . | $\tfrac{1}{2}$ | $\tfrac{1}{4}$ |
|---|---|---|---|---|---|
| $1$ | $1$ | $0$ | . | $1$ | $1$ |

## (e) $-64 + (-96)$ in 8 bits — **1 / 3**

| Value | You wrote | Correct |
|---|---|---|
| $-64$ | $01000000_2$ | $11000000_2$ |
| $-96$ | $00100000_2$ | $10100000_2$ |

Both patterns are the positive numbers $+64$ and $+32$. Same dropped sign bit as (a). The mark you keep is for the column addition itself, which you carried out correctly — but you added two positives, so the conclusion that follows is worthless.

```
    1 1 0 0 0 0 0 0     (-64)
  + 1 0 1 0 0 0 0 0     (-96)
  -----------------
  1 0 1 1 0 0 0 0       carry-out discarded
    0 1 1 0 0 0 0 0     = +96
```

**Overflow DID occur.** You wrote *"no overflow, result is positive"* — the second half is the proof of the first half being wrong. Two negatives added must give a negative; here the sign bit came out $0$, so the answer escaped the register. Stated properly: $-64 + (-96) = -160$, and the 8-bit range stops at $-128$. Answer: **overflow**, because the carry into bit 7 ($1$) differs from the carry out of bit 7 ($0$) — and because $\text{neg} + \text{neg} = \text{pos}$ is impossible.

## (f) Range and most negative value — **0 / 2**

Not answered. The page shows the label `f` and the fragment `2 ?` — I cannot read a range or a bit pattern in it, and I will not credit what is not there.

$$\text{range} = -128 \text{ to } +127 \qquad\text{i.e.}\qquad -2^{7} \text{ to } 2^{7}-1$$

Most negative value: $10000000_2$. Note this is the one pattern that is its own two's complement — invert and add 1 and you get it back.

## (g) $11010110_2$ to hexadecimal — **1 / 2**

| Nibble | You wrote | Correct |
|---|---|---|
| $1101$ | $E$ | $D$ |
| $0110$ | $6$ | $6$ ✔ |

The grouping is right and the low nibble is right. $1101_2 = 8+4+1 = 13 = D$; you gave $E$, which is $1110_2$. Identical off-by-one to (c) — that is now the same mistake twice on one page, so it is not a slip, it is the table.

$$11010110_2 = D6_{16}$$

## (h) $-35$ in one's complement — **1 / 2**

You wrote $01011100_2$, carried straight from your (a). The **explanation is correct and it earns the mark**: one's complement is the inversion with no $+1$ added, which is exactly how it differs from (a).

$$\text{one's complement: } 00100011_2 \xrightarrow{\text{invert}} 11011100_2$$

The pattern is wrong only because the sign-bit error in (a) propagated into it. Get (a) right and this becomes free.

---

## Mark summary

| Part | Awarded | Available |
|---|---|---|
| (a) two's complement of $-35$ | 2 | 3 |
| (b) $45-78$ with overflow rule | 1 | 5 |
| (c) $3CD_{16} \rightarrow$ binary | 1 | 3 |
| (d) $6.75_{10} \rightarrow$ fractional binary | 2 | 3 |
| (e) $-64 + (-96)$ | 1 | 3 |
| (f) range and most negative | 0 | 2 |
| (g) $11010110_2 \rightarrow$ hex | 1 | 2 |
| (h) one's complement | 1 | 2 |
| **Total** | **9** | **23** |

What genuinely improved: the $+1$ step is now being applied (it was the missing step in August), and (d) is fully correct method. What did not move at all: the hex digit table and the sign-magnitude habit — both were named in the quest brief before you started.

NEXT: After every negative you write, check bit 7 is $1$ before you write anything else — that single check recovers (a), (e) and (h), which is 6 of the 14 marks you lost today.
