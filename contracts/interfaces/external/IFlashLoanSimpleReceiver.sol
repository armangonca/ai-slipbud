// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Aave V3 IPool — sadece flashloan fonksiyonu
interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

/// @notice Aave V3 FlashLoan callback interface
interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}
