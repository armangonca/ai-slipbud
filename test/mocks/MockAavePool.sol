// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPool, IFlashLoanSimpleReceiver} from "contracts/interfaces/external/IFlashLoanSimpleReceiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice FlashLoan destekli Aave mock — gerçek Aave'ın akışını taklit eder:
///         1. Receiver'a token gönder
///         2. executeOperation çağır
///         3. Borcu + premium (%0.09) geri çek
contract MockAavePool is IPool {
    using SafeERC20 for IERC20;

    uint256 public constant PREMIUM_BPS = 9; // %0.09 — gerçek Aave V3 ile aynı

    error MockAave__CallbackFailed();
    error MockAave__RepaymentFailed();

    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 /* referralCode */
    )
        external
        override
    {
        uint256 premium = (amount * PREMIUM_BPS) / 10_000;

        IERC20(asset).safeTransfer(receiverAddress, amount);

        bool success =
            IFlashLoanSimpleReceiver(receiverAddress).executeOperation(asset, amount, premium, msg.sender, params);
        if (!success) revert MockAave__CallbackFailed();

        IERC20(asset).safeTransferFrom(receiverAddress, address(this), amount + premium);
    }
}
